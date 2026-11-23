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

  SELECT *
  INTO v_existing
  FROM public.meter_readings
  WHERE room_id = v_room_id
    AND reading_at = v_move_in_date
  ORDER BY reading_id
  LIMIT 1;

  IF FOUND THEN
    IF p_opening_reading_value IS NOT NULL
       AND v_existing.reading_value <> p_opening_reading_value THEN
      RAISE EXCEPTION 'The existing reading on the move-in date does not match the opening reading';
    END IF;
    RETURN v_tenancy_id;
  END IF;

  IF p_opening_reading_value IS NULL THEN
    IF v_move_in_date <= v_today THEN
      RAISE EXCEPTION 'An opening meter reading is required for a tenancy that has started';
    END IF;
    RETURN v_tenancy_id;
  END IF;

  INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
  VALUES (v_room_id, p_opening_reading_value, v_move_in_date);

  RETURN v_tenancy_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_tenancy_with_opening_reading(
  uuid, text, text, text, text, text, date, jsonb, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_tenancy_with_opening_reading(
  uuid, text, text, text, text, text, date, jsonb, numeric
) TO authenticated, service_role;