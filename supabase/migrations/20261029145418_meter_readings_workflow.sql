CREATE TABLE public.room_creation_requests (
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  request_id text NOT NULL,
  room_id uuid NOT NULL REFERENCES public.rooms(room_id) ON DELETE CASCADE,
  boarding_house_id uuid NOT NULL,
  room_name text NOT NULL,
  monthly_rate numeric NOT NULL,
  initial_reading_value numeric,
  initial_reading_at date,
  CONSTRAINT room_creation_requests_pkey PRIMARY KEY (owner_id, request_id),
  CONSTRAINT room_creation_requests_reading_pair_check
    CHECK ((initial_reading_value IS NULL) = (initial_reading_at IS NULL))
);

ALTER TABLE public.room_creation_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.room_creation_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.room_creation_requests TO authenticated;
GRANT ALL ON TABLE public.room_creation_requests TO service_role;

CREATE POLICY "Owners view their room creation requests"
  ON public.room_creation_requests
  FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "Owners record their room creation requests"
  ON public.room_creation_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.rooms r
      JOIN public.boarding_house bh
        ON bh.boarding_house_id = r.boarding_house_id
      WHERE r.room_id = room_creation_requests.room_id
        AND bh.owner_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.create_room_with_meter_reading(
  p_boarding_house_id uuid,
  p_room_name text,
  p_monthly_rate numeric,
  p_request_id text,
  p_initial_reading_value numeric,
  p_initial_reading_at date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := auth.uid();
  v_room_id uuid;
  v_existing public.room_creation_requests%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_request_id IS NULL OR length(p_request_id) < 10 OR length(p_request_id) > 80 THEN
    RAISE EXCEPTION 'A valid room creation request identifier is required';
  END IF;

  IF p_room_name IS NULL OR btrim(p_room_name) = ''
     OR length(btrim(p_room_name)) > 30
     OR p_monthly_rate IS NULL
     OR p_monthly_rate <= 0
     OR p_monthly_rate >= 'Infinity'::numeric
     OR p_monthly_rate = 'NaN'::numeric THEN
    RAISE EXCEPTION 'A room name and valid monthly rate are required';
  END IF;

  IF (p_initial_reading_value IS NULL) <> (p_initial_reading_at IS NULL) THEN
    RAISE EXCEPTION 'Both the initial meter reading and reading date are required';
  END IF;

  IF p_initial_reading_value IS NOT NULL
     AND (
       p_initial_reading_value < 0
       OR p_initial_reading_value >= 'Infinity'::numeric
       OR p_initial_reading_value = 'NaN'::numeric
     ) THEN
    RAISE EXCEPTION 'The initial meter reading must be a valid nonnegative value';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':' || p_request_id, 0)
  );

  SELECT *
  INTO v_existing
  FROM public.room_creation_requests
  WHERE owner_id = v_owner_id
    AND request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.boarding_house_id <> p_boarding_house_id
       OR v_existing.room_name <> btrim(p_room_name)
       OR v_existing.monthly_rate <> p_monthly_rate
       OR v_existing.initial_reading_value IS DISTINCT FROM p_initial_reading_value
       OR v_existing.initial_reading_at IS DISTINCT FROM p_initial_reading_at THEN
      RAISE EXCEPTION 'This room creation request was already completed with different details';
    END IF;
    RETURN v_existing.room_id;
  END IF;

  INSERT INTO public.rooms (boarding_house_id, room_name, monthly_rate)
  VALUES (p_boarding_house_id, btrim(p_room_name), p_monthly_rate)
  RETURNING room_id INTO v_room_id;

  IF p_initial_reading_value IS NOT NULL THEN
    INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
    VALUES (v_room_id, p_initial_reading_value, p_initial_reading_at);
  END IF;

  INSERT INTO public.room_creation_requests (
    owner_id,
    request_id,
    room_id,
    boarding_house_id,
    room_name,
    monthly_rate,
    initial_reading_value,
    initial_reading_at
  )
  VALUES (
    v_owner_id,
    p_request_id,
    v_room_id,
    p_boarding_house_id,
    btrim(p_room_name),
    p_monthly_rate,
    p_initial_reading_value,
    p_initial_reading_at
  );

  RETURN v_room_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_room_with_meter_reading(
  uuid, text, numeric, text, numeric, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room_with_meter_reading(
  uuid, text, numeric, text, numeric, date
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_meter_reading_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_previous public.meter_readings%ROWTYPE;
  v_anchor date;
  v_cycle_start date;
  v_next_cycle_start date;
BEGIN
  IF new.reading_value < 0
     OR new.reading_value >= 'Infinity'::numeric
     OR new.reading_value = 'NaN'::numeric THEN
    RAISE EXCEPTION 'The meter reading must be a valid nonnegative value';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || new.room_id::text, 0)
  );

  PERFORM 1
  FROM public.rooms r
  WHERE r.room_id = new.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found or not authorized';
  END IF;

  SELECT *
  INTO v_previous
  FROM public.meter_readings
  WHERE room_id = new.room_id
  ORDER BY reading_at DESC, reading_id DESC
  LIMIT 1;

  IF FOUND THEN
    IF new.reading_at <= v_previous.reading_at THEN
      RAISE EXCEPTION 'The reading date must be later than the previous reading';
    END IF;
    IF new.reading_value < v_previous.reading_value THEN
      RAISE EXCEPTION 'The reading cannot be lower than the previous reading';
    END IF;
  END IF;

  SELECT move_in_date
  INTO v_anchor
  FROM public.tenancy
  WHERE room_id = new.room_id
    AND status IN ('active', 'scheduled')
  ORDER BY move_in_date DESC
  LIMIT 1;

  IF v_anchor IS NOT NULL AND new.reading_at >= v_anchor THEN
    v_cycle_start := public.cycle_date(v_anchor, new.reading_at);
    v_next_cycle_start :=
      public.cycle_date(v_anchor, (v_cycle_start + interval '1 month')::date);

    IF EXISTS (
      SELECT 1
      FROM public.meter_readings existing
      WHERE existing.room_id = new.room_id
        AND existing.reading_at >= v_cycle_start
        AND existing.reading_at < v_next_cycle_start
    ) THEN
      RAISE EXCEPTION 'A meter reading already exists for this billing cycle';
    END IF;
  END IF;

  RETURN new;
END;
$function$;

CREATE TRIGGER validate_meter_reading_before_insert
  BEFORE INSERT ON public.meter_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_meter_reading_insert();

CREATE OR REPLACE FUNCTION public.set_electricity_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_bill_room uuid;
  v_tenancy_id uuid;
  v_rate numeric;
  v_usage numeric;
BEGIN
  IF new.item_type <> 'electricity' THEN
    new.start_reading_id := NULL;
    new.end_reading_id := NULL;
    RETURN new;
  END IF;

  IF new.start_reading_id IS NULL OR new.end_reading_id IS NULL THEN
    RAISE EXCEPTION 'Electricity items need a start and an end reading';
  END IF;

  SELECT * INTO v_start
  FROM public.meter_readings
  WHERE reading_id = new.start_reading_id;
  SELECT * INTO v_end
  FROM public.meter_readings
  WHERE reading_id = new.end_reading_id;

  IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL THEN
    RAISE EXCEPTION 'Meter reading not found';
  END IF;

  SELECT t.tenancy_id, t.room_id
  INTO v_tenancy_id, v_bill_room
  FROM public.monthly_bill b
  JOIN public.tenancy t ON t.tenancy_id = b.tenancy_id
  WHERE b.bill_id = new.bill_id;

  IF v_tenancy_id IS NULL THEN
    RAISE EXCEPTION 'Bill tenancy not found';
  END IF;

  IF v_start.room_id <> v_end.room_id OR v_start.room_id <> v_bill_room THEN
    RAISE EXCEPTION 'Both readings must belong to the bill''s room';
  END IF;

  IF v_end.reading_at <= v_start.reading_at
     OR v_end.reading_value < v_start.reading_value THEN
    RAISE EXCEPTION 'End reading must be later and not lower than the start reading';
  END IF;

  v_usage := v_end.reading_value - v_start.reading_value;

  SELECT coalesce(tenancy_charge.unit_price, room_charge.unit_price, owner_charge.unit_price)
  INTO v_rate
  FROM public.tenancy t
  LEFT JOIN public.tenancy_default_charges tenancy_charge
    ON tenancy_charge.tenancy_id = t.tenancy_id
    AND tenancy_charge.item_type = 'electricity'
  LEFT JOIN public.room_default_charges room_charge
    ON room_charge.room_id = t.room_id
    AND room_charge.item_type = 'electricity'
  LEFT JOIN public.owner_default_charges owner_charge
    ON owner_charge.owner_id = t.owner_id
    AND owner_charge.item_type = 'electricity'
  WHERE t.tenancy_id = v_tenancy_id;

  IF v_rate IS NULL THEN
    new.quantity := 1;
    new.unit_price := v_usage;
  ELSE
    new.quantity := v_usage;
    new.unit_price := v_rate;
  END IF;

  new.amount := new.quantity * new.unit_price;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_monthly_bill(
  p_tenancy_id uuid,
  p_period_start date,
  p_period_end date,
  p_due_date date
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bill_id uuid;
  v_room uuid;
  v_rent numeric;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
BEGIN
  SELECT room_id, monthly_rate
  INTO v_room, v_rent
  FROM public.tenancy
  WHERE tenancy_id = p_tenancy_id
    AND status = 'active';

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'No active tenancy found';
  END IF;

  INSERT INTO public.monthly_bill (tenancy_id, period_start, period_end, due_date)
  VALUES (p_tenancy_id, p_period_start, p_period_end, p_due_date)
  RETURNING bill_id INTO v_bill_id;

  INSERT INTO public.bill_items (bill_id, item_type, quantity, unit_price)
  VALUES (v_bill_id, 'rent', 1, v_rent);

  INSERT INTO public.bill_items (bill_id, item_type, quantity, unit_price)
  SELECT v_bill_id, charge.item_type, 1, charge.unit_price
  FROM (
    SELECT charge_type.item_type,
           coalesce(tenancy_charge.unit_price, room_charge.unit_price,
                    owner_charge.unit_price) AS unit_price
    FROM (VALUES
      ('water'::public.bill_item_type),
      ('trash'::public.bill_item_type),
      ('wifi'::public.bill_item_type)
    ) AS charge_type(item_type)
    JOIN public.tenancy t ON t.tenancy_id = p_tenancy_id
    LEFT JOIN public.tenancy_default_charges tenancy_charge
      ON tenancy_charge.tenancy_id = t.tenancy_id
      AND tenancy_charge.item_type = charge_type.item_type
    LEFT JOIN public.room_default_charges room_charge
      ON room_charge.room_id = t.room_id
      AND room_charge.item_type = charge_type.item_type
    LEFT JOIN public.owner_default_charges owner_charge
      ON owner_charge.owner_id = t.owner_id
      AND owner_charge.item_type = charge_type.item_type
  ) AS charge
  WHERE charge.unit_price IS NOT NULL;

  SELECT *
  INTO v_end
  FROM public.meter_readings
  WHERE room_id = v_room
    AND reading_at >= p_period_start
    AND reading_at <= p_period_end
  ORDER BY reading_at DESC, reading_id DESC
  LIMIT 1;

  IF FOUND THEN
    SELECT *
    INTO v_start
    FROM public.meter_readings
    WHERE room_id = v_room
      AND reading_at < v_end.reading_at
    ORDER BY reading_at DESC, reading_id DESC
    LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.bill_items (
        bill_id,
        item_type,
        quantity,
        unit_price,
        start_reading_id,
        end_reading_id
      )
      VALUES (
        v_bill_id,
        'electricity',
        1,
        1,
        v_start.reading_id,
        v_end.reading_id
      );
    END IF;
  END IF;

  RETURN v_bill_id;
END;
$function$;