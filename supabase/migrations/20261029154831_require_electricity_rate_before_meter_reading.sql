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

    IF v_rate IS NULL THEN
      RAISE EXCEPTION 'Configure an electricity rate for this tenancy or owner before billing';
    END IF;

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
    'usage', v_item.quantity,
    'rate', v_item.unit_price,
    'amount', v_item.amount
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_bill_electricity_reading(uuid, numeric, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_bill_electricity_reading(uuid, numeric, date)
  TO authenticated, service_role;