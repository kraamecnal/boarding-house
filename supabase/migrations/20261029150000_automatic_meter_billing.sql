ALTER TABLE public.rooms
  ADD COLUMN meter_reading_day smallint NOT NULL DEFAULT 15
    CHECK (meter_reading_day BETWEEN 1 AND 31);

ALTER TABLE public.room_creation_requests
  ADD COLUMN meter_reading_day smallint NOT NULL DEFAULT 15
    CHECK (meter_reading_day BETWEEN 1 AND 31);

DROP FUNCTION public.create_room_with_meter_reading(
  uuid, text, numeric, text, numeric, date
);

CREATE OR REPLACE FUNCTION public.create_room_with_meter_reading(
  p_boarding_house_id uuid,
  p_room_name text,
  p_monthly_rate numeric,
  p_request_id text,
  p_initial_reading_value numeric,
  p_initial_reading_at date,
  p_meter_reading_day smallint
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

  IF p_meter_reading_day IS NULL OR p_meter_reading_day NOT BETWEEN 1 AND 31 THEN
    RAISE EXCEPTION 'The monthly meter reading day must be between 1 and 31';
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
       OR v_existing.initial_reading_at IS DISTINCT FROM p_initial_reading_at
       OR v_existing.meter_reading_day <> p_meter_reading_day THEN
      RAISE EXCEPTION 'This room creation request was already completed with different details';
    END IF;
    RETURN v_existing.room_id;
  END IF;

  INSERT INTO public.rooms (
    boarding_house_id, room_name, monthly_rate, meter_reading_day
  )
  VALUES (
    p_boarding_house_id, btrim(p_room_name), p_monthly_rate, p_meter_reading_day
  )
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
    initial_reading_at,
    meter_reading_day
  )
  VALUES (
    v_owner_id,
    p_request_id,
    v_room_id,
    p_boarding_house_id,
    btrim(p_room_name),
    p_monthly_rate,
    p_initial_reading_value,
    p_initial_reading_at,
    p_meter_reading_day
  );

  RETURN v_room_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_room_with_meter_reading(
  uuid, text, numeric, text, numeric, date, smallint
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room_with_meter_reading(
  uuid, text, numeric, text, numeric, date, smallint
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_meter_reading_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_previous public.meter_readings%ROWTYPE;
  v_meter_day smallint;
  v_cycle_anchor date;
  v_cycle_start date;
  v_next_cycle_start date;
  v_is_tenancy_boundary boolean;
BEGIN
  IF new.reading_value < 0
     OR new.reading_value >= 'Infinity'::numeric
     OR new.reading_value = 'NaN'::numeric THEN
    RAISE EXCEPTION 'The meter reading must be a valid nonnegative value';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || new.room_id::text, 0)
  );

  SELECT meter_reading_day
  INTO v_meter_day
  FROM public.rooms
  WHERE room_id = new.room_id;

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

  v_is_tenancy_boundary := EXISTS (
    SELECT 1
    FROM public.tenancy t
    WHERE t.room_id = new.room_id
      AND (t.move_in_date = new.reading_at OR t.move_out_date = new.reading_at)
  );

  IF NOT v_is_tenancy_boundary THEN
    v_cycle_anchor := make_date(2000, 1, v_meter_day);
    v_cycle_start := public.cycle_date(v_cycle_anchor, new.reading_at);
    v_next_cycle_start :=
      public.cycle_date(v_cycle_anchor, (v_cycle_start + interval '1 month')::date);

    IF EXISTS (
      SELECT 1
      FROM public.meter_readings existing
      WHERE existing.room_id = new.room_id
        AND existing.reading_at >= v_cycle_start
        AND existing.reading_at < v_next_cycle_start
    ) THEN
      RAISE EXCEPTION 'A meter reading already exists for this room''s monthly reading cycle';
    END IF;
  END IF;

  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_electricity_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_bill_start date;
  v_bill_end date;
  v_move_in date;
  v_move_out date;
  v_tenancy_id uuid;
  v_room_id uuid;
  v_rate numeric;
BEGIN
  IF new.item_type <> 'electricity' THEN
    new.start_reading_id := NULL;
    new.end_reading_id := NULL;
    RETURN new;
  END IF;

  IF TG_OP = 'UPDATE'
     AND new.start_reading_id IS NOT DISTINCT FROM old.start_reading_id
     AND new.end_reading_id IS NOT DISTINCT FROM old.end_reading_id THEN
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

  SELECT b.period_start, b.period_end, t.tenancy_id, t.room_id,
         t.move_in_date, t.move_out_date
  INTO v_bill_start, v_bill_end, v_tenancy_id, v_room_id, v_move_in, v_move_out
  FROM public.monthly_bill b
  JOIN public.tenancy t ON t.tenancy_id = b.tenancy_id
  WHERE b.bill_id = new.bill_id;

  IF v_tenancy_id IS NULL THEN
    RAISE EXCEPTION 'Bill tenancy not found';
  END IF;

  IF v_start.room_id <> v_end.room_id OR v_start.room_id <> v_room_id THEN
    RAISE EXCEPTION 'Both readings must belong to the bill''s room';
  END IF;

  IF v_end.reading_at <= v_start.reading_at
     OR v_end.reading_value < v_start.reading_value THEN
    RAISE EXCEPTION 'End reading must be later and not lower than the start reading';
  END IF;

  IF v_start.reading_at < v_move_in
     OR v_end.reading_at < v_move_in
     OR (v_move_out IS NOT NULL AND (
       v_start.reading_at > v_move_out OR v_end.reading_at > v_move_out
     ))
     OR v_end.reading_at < v_bill_start
     OR v_end.reading_at > v_bill_end THEN
    RAISE EXCEPTION 'Readings must fall within this tenancy and the bill period';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenancy other_tenancy
    WHERE other_tenancy.room_id = v_room_id
      AND other_tenancy.tenancy_id <> v_tenancy_id
      AND other_tenancy.move_in_date < v_end.reading_at
      AND coalesce(other_tenancy.move_out_date, 'infinity'::date) > v_start.reading_at
  ) THEN
    RAISE EXCEPTION 'The meter interval overlaps another tenancy';
  END IF;

  SELECT coalesce(tenancy_charge.unit_price, owner_charge.unit_price)
  INTO v_rate
  FROM public.tenancy t
  LEFT JOIN public.tenancy_default_charges tenancy_charge
    ON tenancy_charge.tenancy_id = t.tenancy_id
    AND tenancy_charge.item_type = 'electricity'
  LEFT JOIN public.owner_default_charges owner_charge
    ON owner_charge.owner_id = t.owner_id
    AND owner_charge.item_type = 'electricity'
  WHERE t.tenancy_id = v_tenancy_id;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Set an electricity rate for this tenancy or owner before billing';
  END IF;

  new.quantity := v_end.reading_value - v_start.reading_value;
  new.unit_price := v_rate;
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

  RETURN v_bill_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_tenancy_with_opening_reading(
  p_room_id uuid,
  p_name text,
  p_contact_number text,
  p_email_address text,
  p_id_photo_url text,
  p_agreement_photo_url text,
  p_move_in_date date,
  p_custom_charges jsonb,
  p_opening_reading_value numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenancy_id uuid;
  v_room_id uuid;
  v_move_in_date date;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_existing public.meter_readings%ROWTYPE;
BEGIN
  IF p_opening_reading_value IS NOT NULL
     AND (
       p_opening_reading_value < 0
       OR p_opening_reading_value >= 'Infinity'::numeric
       OR p_opening_reading_value = 'NaN'::numeric
     ) THEN
    RAISE EXCEPTION 'The opening meter reading must be a valid nonnegative value';
  END IF;

  v_tenancy_id := public.register_tenancy(
    p_room_id,
    p_name,
    p_contact_number,
    p_email_address,
    p_id_photo_url,
    p_agreement_photo_url,
    p_move_in_date,
    p_custom_charges
  );

  SELECT room_id, move_in_date
  INTO v_room_id, v_move_in_date
  FROM public.tenancy
  WHERE tenancy_id = v_tenancy_id;

  IF p_opening_reading_value IS NULL THEN
    IF v_move_in_date <= v_today THEN
      RAISE EXCEPTION 'An opening meter reading is required for a tenancy that has started';
    END IF;
    RETURN v_tenancy_id;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.meter_readings
  WHERE room_id = v_room_id
    AND reading_at = v_move_in_date;

  IF FOUND THEN
    IF v_existing.reading_value <> p_opening_reading_value THEN
      RAISE EXCEPTION 'The existing reading on the move-in date does not match the opening reading';
    END IF;
  ELSE
    INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
    VALUES (v_room_id, p_opening_reading_value, v_move_in_date);
  END IF;

  RETURN v_tenancy_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_tenancy_with_opening_reading(
  uuid, text, text, text, text, text, date, jsonb, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_tenancy_with_opening_reading(
  uuid, text, text, text, text, text, date, jsonb, numeric
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_bill_electricity_context(
  p_bill_id uuid,
  p_reading_at date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bill public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
  v_meter_day smallint;
  v_rate numeric;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
BEGIN
  SELECT * INTO v_bill
  FROM public.monthly_bill
  WHERE bill_id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_bill.tenancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill tenancy not found or not authorized';
  END IF;

  SELECT meter_reading_day
  INTO v_meter_day
  FROM public.rooms
  WHERE room_id = v_tenancy.room_id;

  SELECT coalesce(tc.unit_price, oc.unit_price)
  INTO v_rate
  FROM public.tenancy t
  LEFT JOIN public.tenancy_default_charges tc
    ON tc.tenancy_id = t.tenancy_id AND tc.item_type = 'electricity'
  LEFT JOIN public.owner_default_charges oc
    ON oc.owner_id = t.owner_id AND oc.item_type = 'electricity'
  WHERE t.tenancy_id = v_tenancy.tenancy_id;

  SELECT * INTO v_item
  FROM public.bill_items
  WHERE bill_id = p_bill_id
    AND item_type = 'electricity'
  ORDER BY bill_item_id
  LIMIT 1;

  IF v_item.bill_item_id IS NOT NULL THEN
    SELECT * INTO v_start FROM public.meter_readings
    WHERE reading_id = v_item.start_reading_id;
    SELECT * INTO v_end FROM public.meter_readings
    WHERE reading_id = v_item.end_reading_id;
  ELSIF p_reading_at IS NOT NULL THEN
    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at < p_reading_at
      AND reading_at >= v_tenancy.move_in_date
      AND (v_tenancy.move_out_date IS NULL OR reading_at <= v_tenancy.move_out_date)
    ORDER BY reading_at DESC, reading_id DESC
    LIMIT 1;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at = p_reading_at;
  END IF;

  RETURN jsonb_build_object(
    'periodStart', v_bill.period_start,
    'periodEnd', v_bill.period_end,
    'meterReadingDay', v_meter_day,
    'readingDateValid',
      p_reading_at IS NOT NULL
      AND p_reading_at BETWEEN v_bill.period_start AND v_bill.period_end
      AND p_reading_at <= (now() AT TIME ZONE 'Asia/Manila')::date
      AND p_reading_at >= v_tenancy.move_in_date
      AND (v_tenancy.move_out_date IS NULL OR p_reading_at <= v_tenancy.move_out_date),
    'rate', v_rate,
    'isLocked', v_bill.billed_at IS NOT NULL OR coalesce(v_bill.is_paid, false),
    'saved', v_item.bill_item_id IS NOT NULL,
    'previousReading', CASE WHEN v_start.reading_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_start.reading_id,
      'value', v_start.reading_value,
      'readingAt', v_start.reading_at
    ) END,
    'currentReading', CASE WHEN v_end.reading_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_end.reading_id,
      'value', v_end.reading_value,
      'readingAt', v_end.reading_at
    ) END,
    'usage', CASE WHEN v_item.bill_item_id IS NULL THEN NULL ELSE v_item.quantity END,
    'amount', CASE WHEN v_item.bill_item_id IS NULL THEN NULL ELSE v_item.amount END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_bill_electricity_context(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bill_electricity_context(uuid, date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_bill_electricity_reading(
  p_bill_id uuid,
  p_reading_value numeric,
  p_reading_at date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_bill public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
  v_rate numeric;
  v_usage numeric;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_is_new_reading boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_reading_value IS NULL
     OR p_reading_value < 0
     OR p_reading_value >= 'Infinity'::numeric
     OR p_reading_value = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Enter a valid nonnegative meter reading';
  END IF;

  IF p_reading_at IS NULL OR p_reading_at > v_today THEN
    RAISE EXCEPTION 'The meter reading date cannot be in the future';
  END IF;

  SELECT * INTO v_bill
  FROM public.monthly_bill
  WHERE bill_id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;
  IF v_bill.billed_at IS NOT NULL OR coalesce(v_bill.is_paid, false) THEN
    RAISE EXCEPTION 'This bill is finalized and can no longer be changed';
  END IF;
  IF p_reading_at < v_bill.period_start OR p_reading_at > v_bill.period_end THEN
    RAISE EXCEPTION 'The reading date must fall within this bill period';
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_bill.tenancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill tenancy not found or not authorized';
  END IF;
  IF p_reading_at < v_tenancy.move_in_date
     OR (v_tenancy.move_out_date IS NOT NULL
         AND p_reading_at > v_tenancy.move_out_date) THEN
    RAISE EXCEPTION 'The reading date must fall within this tenancy';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || v_tenancy.room_id::text, 0)
  );

  SELECT * INTO v_item
  FROM public.bill_items
  WHERE bill_id = p_bill_id
    AND item_type = 'electricity'
  ORDER BY bill_item_id
  LIMIT 1;

  IF v_item.bill_item_id IS NOT NULL THEN
    IF v_item.end_reading_id IN (
      SELECT reading_id
      FROM public.meter_readings
      WHERE room_id = v_tenancy.room_id
        AND reading_at = p_reading_at
        AND reading_value = p_reading_value
    ) THEN
      SELECT * INTO v_start FROM public.meter_readings
      WHERE reading_id = v_item.start_reading_id;
      SELECT * INTO v_end FROM public.meter_readings
      WHERE reading_id = v_item.end_reading_id;
    ELSE
      RAISE EXCEPTION 'An electricity reading is already saved on this bill';
    END IF;
  ELSE
    SELECT coalesce(tc.unit_price, oc.unit_price)
    INTO v_rate
    FROM public.tenancy t
    LEFT JOIN public.tenancy_default_charges tc
      ON tc.tenancy_id = t.tenancy_id AND tc.item_type = 'electricity'
    LEFT JOIN public.owner_default_charges oc
      ON oc.owner_id = t.owner_id AND oc.item_type = 'electricity'
    WHERE t.tenancy_id = v_tenancy.tenancy_id;

    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at < p_reading_at
      AND reading_at >= v_tenancy.move_in_date
      AND (v_tenancy.move_out_date IS NULL OR reading_at <= v_tenancy.move_out_date)
    ORDER BY reading_at DESC, reading_id DESC
    LIMIT 1;

    IF v_start.reading_id IS NULL THEN
      RAISE EXCEPTION 'An opening meter reading for this tenancy is required before billing';
    END IF;

    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at = p_reading_at
    FOR UPDATE;

    IF FOUND THEN
      IF v_end.reading_value <> p_reading_value THEN
        RAISE EXCEPTION 'A different meter reading is already saved for this date';
      END IF;
    ELSE
      INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
      VALUES (v_tenancy.room_id, p_reading_value, p_reading_at)
      RETURNING * INTO v_end;
      v_is_new_reading := true;
    END IF;

    IF v_end.reading_at <= v_start.reading_at
       OR v_end.reading_value < v_start.reading_value THEN
      RAISE EXCEPTION 'The current reading must be later and no lower than the previous reading';
    END IF;
    v_usage := v_end.reading_value - v_start.reading_value;

    IF EXISTS (
      SELECT 1
      FROM public.bill_items other_item
      WHERE other_item.item_type = 'electricity'
        AND other_item.end_reading_id = v_end.reading_id
    ) THEN
      RAISE EXCEPTION 'This meter reading is already attached to another bill';
    END IF;

    IF v_rate IS NOT NULL THEN
      INSERT INTO public.bill_items (
        bill_id, item_type, quantity, unit_price, start_reading_id, end_reading_id
      )
      VALUES (
        p_bill_id,
        'electricity',
        v_usage,
        v_rate,
        v_start.reading_id,
        v_end.reading_id
      )
      RETURNING * INTO v_item;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'saved', true,
    'electricityBilled', v_item.bill_item_id IS NOT NULL,
    'createdReading', v_is_new_reading,
    'previousReading', jsonb_build_object(
      'id', v_start.reading_id,
      'value', v_start.reading_value,
      'readingAt', v_start.reading_at
    ),
    'currentReading', jsonb_build_object(
      'id', v_end.reading_id,
      'value', v_end.reading_value,
      'readingAt', v_end.reading_at
    ),
    'usage', coalesce(v_item.quantity, v_usage),
    'rate', v_item.unit_price,
    'amount', v_item.amount
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_bill_electricity_reading(uuid, numeric, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_bill_electricity_reading(uuid, numeric, date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.close_tenancy_with_meter_reading(
  p_tenancy_id uuid,
  p_move_out_date date,
  p_reading_value numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenancy public.tenancy%ROWTYPE;
  v_existing public.meter_readings%ROWTYPE;
  v_closing public.meter_readings%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_bill public.monthly_bill%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
  v_rate numeric;
  v_period_start date;
  v_period_end date;
  v_electricity_billed boolean := false;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_move_out_date IS NULL OR p_move_out_date > v_today THEN
    RAISE EXCEPTION 'The move-out reading date must be today or earlier';
  END IF;
  IF p_reading_value IS NULL
     OR p_reading_value < 0
     OR p_reading_value >= 'Infinity'::numeric
     OR p_reading_value = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Enter a valid nonnegative closing meter reading';
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = p_tenancy_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenancy not found or not authorized';
  END IF;
  IF v_tenancy.status NOT IN ('active', 'scheduled') THEN
    RAISE EXCEPTION 'This tenancy has already ended';
  END IF;
  IF p_move_out_date < v_tenancy.move_in_date THEN
    RAISE EXCEPTION 'The move-out date cannot be before the move-in date';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || v_tenancy.room_id::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.meter_readings
  WHERE room_id = v_tenancy.room_id
    AND reading_at = p_move_out_date
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.reading_value <> p_reading_value THEN
      RAISE EXCEPTION 'A different meter reading is already saved for the move-out date';
    END IF;
    v_closing := v_existing;
  ELSE
    INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
    VALUES (v_tenancy.room_id, p_reading_value, p_move_out_date)
    RETURNING * INTO v_closing;
  END IF;

  SELECT * INTO v_bill
  FROM public.monthly_bill
  WHERE tenancy_id = p_tenancy_id
    AND p_move_out_date BETWEEN period_start AND period_end
  ORDER BY period_start DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.tenancy
    SET last_updated_at = now()
    WHERE tenancy_id = p_tenancy_id;

    v_period_start := public.cycle_date(v_tenancy.move_in_date, p_move_out_date);
    v_period_end :=
      public.cycle_date(
        v_tenancy.move_in_date,
        (v_period_start + interval '1 month')::date
      ) - 1;
    PERFORM public.generate_monthly_bill(
      p_tenancy_id,
      v_period_start,
      v_period_end,
      v_period_start
    );

    SELECT * INTO v_bill
    FROM public.monthly_bill
    WHERE tenancy_id = p_tenancy_id
      AND p_move_out_date BETWEEN period_start AND period_end
    ORDER BY period_start DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_bill.bill_id IS NOT NULL
     AND v_bill.billed_at IS NULL
     AND NOT coalesce(v_bill.is_paid, false) THEN
    SELECT coalesce(tc.unit_price, oc.unit_price)
    INTO v_rate
    FROM public.tenancy t
    LEFT JOIN public.tenancy_default_charges tc
      ON tc.tenancy_id = t.tenancy_id AND tc.item_type = 'electricity'
    LEFT JOIN public.owner_default_charges oc
      ON oc.owner_id = t.owner_id AND oc.item_type = 'electricity'
    WHERE t.tenancy_id = p_tenancy_id;

    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at < p_move_out_date
      AND reading_at >= v_tenancy.move_in_date
    ORDER BY reading_at DESC, reading_id DESC
    LIMIT 1;

    IF v_rate IS NOT NULL AND v_start.reading_id IS NOT NULL
       AND v_closing.reading_value >= v_start.reading_value THEN
      SELECT * INTO v_item
      FROM public.bill_items
      WHERE bill_id = v_bill.bill_id
        AND item_type = 'electricity'
      ORDER BY bill_item_id
      LIMIT 1;

      IF v_item.bill_item_id IS NOT NULL THEN
        UPDATE public.bill_items
        SET end_reading_id = v_closing.reading_id
        WHERE bill_item_id = v_item.bill_item_id
          AND end_reading_id IS DISTINCT FROM v_closing.reading_id;
        v_electricity_billed := true;
      ELSE
        INSERT INTO public.bill_items (
          bill_id, item_type, quantity, unit_price, start_reading_id, end_reading_id
        )
        VALUES (
          v_bill.bill_id,
          'electricity',
          v_closing.reading_value - v_start.reading_value,
          v_rate,
          v_start.reading_id,
          v_closing.reading_id
        );
        v_electricity_billed := true;
      END IF;
    END IF;
  END IF;

  UPDATE public.tenancy
  SET move_out_date = p_move_out_date
  WHERE tenancy_id = p_tenancy_id;

  RETURN jsonb_build_object('electricityBilled', v_electricity_billed);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_tenancy_with_meter_reading(uuid, date, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_tenancy_with_meter_reading(uuid, date, numeric)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.require_tenancy_closing_reading()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status = 'ended'
     AND OLD.status IS DISTINCT FROM 'ended'
     AND NOT EXISTS (
       SELECT 1
       FROM public.meter_readings mr
       WHERE mr.room_id = NEW.room_id
         AND mr.reading_at = NEW.move_out_date
     ) THEN
    RAISE EXCEPTION 'A closing meter reading is required before ending this tenancy';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER require_meter_reading_before_tenancy_end
  BEFORE UPDATE ON public.tenancy
  FOR EACH ROW
  EXECUTE FUNCTION public.require_tenancy_closing_reading();