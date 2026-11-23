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
    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE reading_id = new.start_reading_id;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE reading_id = new.end_reading_id;

    IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL THEN
      RAISE EXCEPTION 'Meter reading not found';
    END IF;
    IF v_end.reading_at <= v_start.reading_at
       OR v_end.reading_value < v_start.reading_value THEN
      RAISE EXCEPTION 'End reading must be later and not lower than the start reading';
    END IF;

    new.quantity := v_end.reading_value - v_start.reading_value;
    new.unit_price := old.unit_price;
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
  FROM public.monthly_bill AS b
  JOIN public.tenancy AS t ON t.tenancy_id = b.tenancy_id
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
    FROM public.tenancy AS other_tenancy
    WHERE other_tenancy.room_id = v_room_id
      AND other_tenancy.tenancy_id <> v_tenancy_id
      AND other_tenancy.move_in_date < v_end.reading_at
      AND coalesce(other_tenancy.move_out_date, 'infinity'::date) > v_start.reading_at
  ) THEN
    RAISE EXCEPTION 'The meter interval overlaps another tenancy';
  END IF;

  SELECT coalesce(tenancy_charge.unit_price, owner_charge.unit_price)
  INTO v_rate
  FROM public.tenancy AS tenancy
  LEFT JOIN public.tenancy_default_charges AS tenancy_charge
    ON tenancy_charge.tenancy_id = tenancy.tenancy_id
    AND tenancy_charge.item_type = 'electricity'
  LEFT JOIN public.owner_default_charges AS owner_charge
    ON owner_charge.owner_id = tenancy.owner_id
    AND owner_charge.item_type = 'electricity'
  WHERE tenancy.tenancy_id = v_tenancy_id;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Set an electricity rate for this tenancy or owner before billing';
  END IF;

  new.quantity := v_end.reading_value - v_start.reading_value;
  new.unit_price := v_rate;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.correct_bill_meter_reading(
  p_bill_id uuid,
  p_new_reading_value numeric,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid := auth.uid();
  v_bill public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_expected_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_latest public.meter_readings%ROWTYPE;
  v_existing public.bill_meter_reading_corrections%ROWTYPE;
  v_usage numeric;
  v_amount numeric;
  v_total numeric;
  v_corrected_at timestamptz;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_bill_id IS NULL THEN
    RAISE EXCEPTION 'A bill is required';
  END IF;
  IF p_request_id IS NULL
     OR length(btrim(p_request_id)) < 8
     OR length(p_request_id) > 100 THEN
    RAISE EXCEPTION 'A valid correction request identifier is required';
  END IF;
  IF p_new_reading_value IS NULL
     OR p_new_reading_value < 0
     OR p_new_reading_value >= 'Infinity'::numeric
     OR p_new_reading_value = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Enter a valid nonnegative meter reading';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.bill_meter_reading_corrections
  WHERE owner_id = v_owner_id
    AND request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.bill_id <> p_bill_id
       OR v_existing.new_value <> p_new_reading_value THEN
      RAISE EXCEPTION 'This correction request was already used for a different change';
    END IF;

    RETURN jsonb_build_object(
      'corrected', true,
      'alreadyApplied', true,
      'correctionId', v_existing.correction_id,
      'billId', v_existing.bill_id,
      'readingId', v_existing.reading_id,
      'oldValue', v_existing.old_value,
      'newValue', v_existing.new_value,
      'correctedAt', v_existing.corrected_at,
      'usage', v_existing.usage,
      'rate', v_existing.unit_price,
      'electricityCharge', v_existing.electricity_charge,
      'totalAmount', v_existing.total_amount
    );
  END IF;

  SELECT bill.*
  INTO v_bill
  FROM public.monthly_bill AS bill
  JOIN public.tenancy AS tenancy
    ON tenancy.tenancy_id = bill.tenancy_id
  WHERE bill.bill_id = p_bill_id
    AND tenancy.owner_id = v_owner_id
  FOR UPDATE OF bill;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.bill_meter_reading_corrections
  WHERE owner_id = v_owner_id
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.bill_id <> p_bill_id
       OR v_existing.new_value <> p_new_reading_value THEN
      RAISE EXCEPTION 'This correction request was already used for a different change';
    END IF;
    RETURN jsonb_build_object(
      'corrected', true,
      'alreadyApplied', true,
      'correctionId', v_existing.correction_id,
      'billId', v_existing.bill_id,
      'readingId', v_existing.reading_id,
      'oldValue', v_existing.old_value,
      'newValue', v_existing.new_value,
      'correctedAt', v_existing.corrected_at,
      'usage', v_existing.usage,
      'rate', v_existing.unit_price,
      'electricityCharge', v_existing.electricity_charge,
      'totalAmount', v_existing.total_amount
    );
  END IF;

  IF v_bill.billed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This bill is finalized and can no longer be changed.';
  END IF;
  IF coalesce(v_bill.is_paid, false) OR v_bill.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'This bill is paid, so the reading cannot be changed.';
  END IF;

  SELECT *
  INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_bill.tenancy_id
    AND owner_id = v_owner_id
  FOR UPDATE;
  IF NOT FOUND OR v_tenancy.status <> 'active' OR v_tenancy.room_id IS NULL THEN
    RAISE EXCEPTION 'Only an active tenant''s bill reading can be corrected.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tenant_archive AS archive
    WHERE archive.tenancy_id = v_tenancy.tenancy_id
  ) THEN
    RAISE EXCEPTION 'Only an active tenant''s bill reading can be corrected.';
  END IF;

  IF v_bill.electricity_roll_forward_to_bill_id IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.monthly_bill AS source
       WHERE source.electricity_roll_forward_to_bill_id = v_bill.bill_id
     ) THEN
    RAISE EXCEPTION 'This reading is part of a carry-forward and cannot be changed.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || v_tenancy.room_id::text, 0)
  );

  SELECT *
  INTO v_item
  FROM public.bill_items
  WHERE bill_id = v_bill.bill_id
    AND item_type = 'electricity'
  ORDER BY bill_item_id
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no saved meter reading on this bill';
  END IF;

  SELECT *
  INTO v_start
  FROM public.meter_readings
  WHERE reading_id = v_item.start_reading_id;
  SELECT *
  INTO v_end
  FROM public.meter_readings
  WHERE reading_id = v_item.end_reading_id
  FOR UPDATE;

  IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL
     OR v_start.room_id <> v_tenancy.room_id
     OR v_end.room_id <> v_tenancy.room_id THEN
    RAISE EXCEPTION 'The bill meter reading is not valid';
  END IF;
  IF v_end.reading_at = v_tenancy.move_in_date THEN
    RAISE EXCEPTION 'The tenant''s move-in reading cannot be changed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.meter_readings AS earlier
    WHERE earlier.room_id = v_tenancy.room_id
      AND earlier.reading_at < v_end.reading_at
  ) THEN
    RAISE EXCEPTION 'The initial meter reading cannot be changed.';
  END IF;

  SELECT *
  INTO v_expected_start
  FROM public.meter_readings
  WHERE room_id = v_tenancy.room_id
    AND reading_at < v_end.reading_at
    AND reading_at >= v_tenancy.move_in_date
    AND (
      v_tenancy.move_out_date IS NULL
      OR reading_at <= v_tenancy.move_out_date
    )
  ORDER BY reading_at DESC, reading_id DESC
  LIMIT 1;
  IF v_expected_start.reading_id IS DISTINCT FROM v_start.reading_id THEN
    RAISE EXCEPTION 'A different previous reading exists, so this bill cannot be corrected.';
  END IF;

  SELECT *
  INTO v_latest
  FROM public.meter_readings
  WHERE room_id = v_tenancy.room_id
  ORDER BY reading_at DESC, reading_id DESC
  LIMIT 1;
  IF v_latest.reading_id IS DISTINCT FROM v_end.reading_id THEN
    RAISE EXCEPTION 'A later reading exists. Only the latest reading can be corrected.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bill_items AS other_item
    WHERE other_item.item_type = 'electricity'
      AND other_item.end_reading_id = v_end.reading_id
      AND other_item.bill_item_id <> v_item.bill_item_id
  ) THEN
    RAISE EXCEPTION 'This meter reading is already attached to another bill';
  END IF;

  IF p_new_reading_value < v_start.reading_value THEN
    RAISE EXCEPTION 'The new reading cannot be lower than the previous reading.';
  END IF;
  IF p_new_reading_value = v_end.reading_value THEN
    RAISE EXCEPTION 'The new reading must be different from the saved reading';
  END IF;

  v_usage := p_new_reading_value - v_start.reading_value;
  v_amount := v_usage * v_item.unit_price;

  UPDATE public.meter_readings
  SET reading_value = p_new_reading_value
  WHERE reading_id = v_end.reading_id;

  UPDATE public.bill_items
  SET quantity = v_usage
  WHERE bill_item_id = v_item.bill_item_id;

  SELECT total_amount
  INTO v_total
  FROM public.monthly_bill
  WHERE bill_id = v_bill.bill_id;
  v_corrected_at := now();

  INSERT INTO public.bill_meter_reading_corrections (
    owner_id,
    request_id,
    bill_id,
    reading_id,
    old_value,
    new_value,
    corrected_at,
    usage,
    unit_price,
    electricity_charge,
    total_amount
  )
  VALUES (
    v_owner_id,
    p_request_id,
    v_bill.bill_id,
    v_end.reading_id,
    v_end.reading_value,
    p_new_reading_value,
    v_corrected_at,
    v_usage,
    v_item.unit_price,
    v_amount,
    v_total
  )
  RETURNING correction_id INTO v_existing.correction_id;

  RETURN jsonb_build_object(
    'corrected', true,
    'alreadyApplied', false,
    'correctionId', v_existing.correction_id,
    'billId', v_bill.bill_id,
    'readingId', v_end.reading_id,
    'oldValue', v_end.reading_value,
    'newValue', p_new_reading_value,
    'correctedAt', v_corrected_at,
    'usage', v_usage,
    'rate', v_item.unit_price,
    'electricityCharge', v_amount,
    'totalAmount', v_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.correct_bill_meter_reading(uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_bill_meter_reading(uuid, numeric, text)
  TO authenticated, service_role;
