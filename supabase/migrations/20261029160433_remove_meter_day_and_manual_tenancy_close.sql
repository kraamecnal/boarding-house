DROP TRIGGER IF EXISTS require_meter_reading_before_tenancy_end ON public.tenancy;
DROP FUNCTION IF EXISTS public.require_tenancy_closing_reading();
DROP FUNCTION IF EXISTS public.close_tenancy_with_meter_reading(uuid, date, numeric);
DROP POLICY IF EXISTS "owners update own tenancies" ON public.tenancy;

DROP FUNCTION public.create_room_with_meter_reading(
  uuid, text, numeric, text, numeric, date, smallint
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

  RETURN new;
END;
$function$;

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

ALTER TABLE public.room_creation_requests
  DROP COLUMN meter_reading_day;
ALTER TABLE public.rooms
  DROP COLUMN meter_reading_day;