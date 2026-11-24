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
  v_is_final_move_out boolean := coalesce(
    current_setting('inkeeper.final_move_out_room_id', true) = new.room_id::text,
    false
  );
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

  IF NOT v_is_final_move_out
     AND v_anchor IS NOT NULL
     AND new.reading_at >= v_anchor THEN
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

CREATE OR REPLACE FUNCTION public.set_electricity_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
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
  v_is_final_move_out boolean := coalesce(
    current_setting('inkeeper.final_move_out_bill_id', true) = new.bill_id::text,
    false
  );
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
      RAISE EXCEPTION USING
        ERRCODE = 'IK011',
        MESSAGE = 'The bill meter reading is not valid',
        HINT = 'invalid_reading_link';
    END IF;
    IF v_end.reading_at <= v_start.reading_at
       OR v_end.reading_value < v_start.reading_value THEN
      RAISE EXCEPTION USING
        ERRCODE = 'IK009',
        MESSAGE = 'The new reading cannot be lower than the previous reading.',
        HINT = 'value_below_previous';
    END IF;

    new.quantity := v_end.reading_value - v_start.reading_value;
    new.unit_price := old.unit_price;
    RETURN new;
  END IF;

  IF new.start_reading_id IS NULL OR new.end_reading_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'IK011',
      MESSAGE = 'Electricity items need a start and an end reading',
      HINT = 'invalid_reading_link';
  END IF;

  SELECT * INTO v_start
  FROM public.meter_readings
  WHERE reading_id = new.start_reading_id;
  SELECT * INTO v_end
  FROM public.meter_readings
  WHERE reading_id = new.end_reading_id;

  IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'IK011',
      MESSAGE = 'Meter reading not found',
      HINT = 'invalid_reading_link';
  END IF;

  SELECT
    bill.period_start,
    bill.period_end,
    tenancy.tenancy_id,
    tenancy.room_id,
    tenancy.move_in_date,
    tenancy.move_out_date
  INTO
    v_bill_start,
    v_bill_end,
    v_tenancy_id,
    v_room_id,
    v_move_in,
    v_move_out
  FROM public.monthly_bill AS bill
  JOIN public.tenancy AS tenancy
    ON tenancy.tenancy_id = bill.tenancy_id
  WHERE bill.bill_id = new.bill_id;

  IF v_tenancy_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'IK010',
      MESSAGE = 'Bill tenancy not found',
      HINT = 'not_authorized';
  END IF;
  IF v_start.room_id <> v_end.room_id OR v_start.room_id <> v_room_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'IK011',
      MESSAGE = 'Both readings must belong to the bill''s room',
      HINT = 'invalid_reading_link';
  END IF;
  IF v_end.reading_at <= v_start.reading_at
     OR v_end.reading_value < v_start.reading_value THEN
    RAISE EXCEPTION USING
      ERRCODE = 'IK009',
      MESSAGE = 'End reading must be later and not lower than the start reading',
      HINT = 'value_below_previous';
  END IF;
  IF v_start.reading_at < v_move_in
     OR v_end.reading_at < v_move_in
     OR (
       NOT v_is_final_move_out
       AND (
         (v_move_out IS NOT NULL AND (
           v_start.reading_at > v_move_out OR v_end.reading_at > v_move_out
         ))
         OR v_end.reading_at < v_bill_start
         OR v_end.reading_at > v_bill_end
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'IK011',
      MESSAGE = 'Readings must fall within this tenancy and the bill period',
      HINT = 'invalid_reading_link';
  END IF;
  IF NOT v_is_final_move_out AND EXISTS (
    SELECT 1
    FROM public.tenancy AS other_tenancy
    WHERE other_tenancy.room_id = v_room_id
      AND other_tenancy.tenancy_id <> v_tenancy_id
      AND other_tenancy.move_in_date < v_end.reading_at
      AND coalesce(other_tenancy.move_out_date, 'infinity'::date) > v_start.reading_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'IK011',
      MESSAGE = 'The meter interval overlaps another tenancy',
      HINT = 'invalid_reading_link';
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
    RAISE EXCEPTION USING
      ERRCODE = 'IK011',
      MESSAGE = 'Set an electricity rate for this tenancy or owner before billing',
      HINT = 'missing_electricity_rate';
  END IF;

  new.quantity := v_end.reading_value - v_start.reading_value;
  new.unit_price := v_rate;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_final_move_out_no_charge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND old.item_type = 'adjustment'
     AND old.description = 'Electricity not charged' THEN
    RAISE EXCEPTION 'The no-electricity-charge exception cannot be changed or removed';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND new.item_type = 'electricity'
     AND EXISTS (
       SELECT 1
       FROM public.bill_items AS item
       WHERE item.bill_id = new.bill_id
         AND item.bill_item_id IS DISTINCT FROM new.bill_item_id
         AND item.item_type = 'adjustment'
         AND item.description = 'Electricity not charged'
     ) THEN
    RAISE EXCEPTION 'Electricity was not charged on this final bill. This exception cannot be undone.';
  END IF;

  RETURN coalesce(new, old);
END;
$function$;

DROP TRIGGER IF EXISTS guard_final_move_out_no_charge
  ON public.bill_items;
CREATE TRIGGER guard_final_move_out_no_charge
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.bill_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_final_move_out_no_charge();

CREATE OR REPLACE FUNCTION public.preview_tenant_move_out(
  p_tenancy_id uuid,
  p_move_out_date date,
  p_electricity_option text DEFAULT NULL,
  p_reading_value numeric DEFAULT NULL,
  p_reading_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid := auth.uid();
  v_tenancy public.tenancy%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_last_reading public.meter_readings%ROWTYPE;
  v_last_payment_date date;
  v_last_finalized_end date;
  v_earliest date;
  v_final_bill public.monthly_bill%ROWTYPE;
  v_existing_reading public.meter_readings%ROWTYPE;
  v_previous_reading public.meter_readings%ROWTYPE;
  v_next_tenancy public.tenancy%ROWTYPE;
  v_next_reading public.meter_readings%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
  v_period_start date;
  v_base_total numeric;
  v_rate numeric;
  v_units numeric := 0;
  v_electricity numeric := 0;
  v_later_blocker record;
  v_later_count integer;
  v_zero_span boolean := false;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT tenancy.*
  INTO v_tenancy
  FROM public.tenancy AS tenancy
  WHERE tenancy.tenancy_id = p_tenancy_id
    AND tenancy.owner_id = v_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenancy not found or not authorized';
  END IF;
  IF v_tenancy.status <> 'active' OR v_tenancy.move_out_date IS NOT NULL THEN
    RAISE EXCEPTION 'Only a current tenant can be archived';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tenant_archive AS archive
    WHERE archive.tenancy_id = v_tenancy.tenancy_id
  ) THEN
    RAISE EXCEPTION 'This tenancy is already archived';
  END IF;

  SELECT *
  INTO v_last_reading
  FROM public.meter_readings
  WHERE room_id = v_tenancy.room_id
  ORDER BY reading_at DESC, reading_id DESC
  LIMIT 1;

  SELECT max((bill.paid_at AT TIME ZONE 'Asia/Manila')::date)
  INTO v_last_payment_date
  FROM public.monthly_bill AS bill
  WHERE bill.tenancy_id = v_tenancy.tenancy_id
    AND bill.paid_at IS NOT NULL;

  SELECT max(bill.period_end)
  INTO v_last_finalized_end
  FROM public.monthly_bill AS bill
  WHERE bill.tenancy_id = v_tenancy.tenancy_id
    AND bill.billed_at IS NOT NULL;

  v_earliest := GREATEST(
    v_tenancy.move_in_date,
    coalesce(v_last_reading.reading_at, v_tenancy.move_in_date),
    coalesce(v_last_payment_date, v_tenancy.move_in_date),
    coalesce(v_last_finalized_end, v_tenancy.move_in_date)
  );

  IF p_move_out_date IS NULL THEN
    RAISE EXCEPTION 'Choose a move-out date';
  END IF;
  IF p_move_out_date > v_today THEN
    RAISE EXCEPTION 'The move-out date cannot be in the future';
  END IF;
  IF p_move_out_date < v_earliest THEN
    RAISE EXCEPTION 'The move-out date cannot be before %', v_earliest;
  END IF;

  SELECT later.bill_id, later.period_start
  INTO v_later_blocker
  FROM public.monthly_bill AS later
  WHERE later.tenancy_id = v_tenancy.tenancy_id
    AND later.period_start > p_move_out_date
    AND (
      later.billed_at IS NOT NULL
      OR later.paid_at IS NOT NULL
      OR coalesce(later.is_paid, false)
      OR later.electricity_roll_forward_to_bill_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.monthly_bill AS carried
        WHERE carried.electricity_roll_forward_to_bill_id = later.bill_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.bill_items AS item
        WHERE item.bill_id = later.bill_id
          AND (
            item.end_reading_id IS NOT NULL
            OR (
              item.item_type = 'adjustment'
              AND item.description = 'Electricity not charged'
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.meter_readings AS reading
        WHERE reading.room_id = v_tenancy.room_id
          AND reading.reading_at BETWEEN later.period_start AND later.period_end
      )
    )
  ORDER BY later.period_start
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'A bill starting % cannot be removed because it is finalized, paid, has a meter reading, or is in a carry-forward chain. Resolve it before archiving.',
      v_later_blocker.period_start;
  END IF;

  SELECT count(*)
  INTO v_later_count
  FROM public.monthly_bill
  WHERE tenancy_id = v_tenancy.tenancy_id
    AND period_start > p_move_out_date;

  SELECT *
  INTO v_final_bill
  FROM public.monthly_bill
  WHERE tenancy_id = v_tenancy.tenancy_id
    AND period_start <= p_move_out_date
  ORDER BY period_start DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_final_bill.billed_at IS NOT NULL
       OR v_final_bill.paid_at IS NOT NULL
       OR coalesce(v_final_bill.is_paid, false) THEN
      RAISE EXCEPTION 'The final bill is already finalized or paid and cannot be changed';
    END IF;
    IF v_final_bill.electricity_roll_forward_to_bill_id IS NOT NULL
       OR EXISTS (
         SELECT 1
         FROM public.monthly_bill AS carried
         WHERE carried.electricity_roll_forward_to_bill_id = v_final_bill.bill_id
       ) THEN
      RAISE EXCEPTION 'The final bill is in a carry-forward chain. Resolve it before archiving.';
    END IF;

    v_period_start := v_final_bill.period_start;
    SELECT coalesce(sum(item.amount), 0)
    INTO v_base_total
    FROM public.bill_items AS item
    WHERE item.bill_id = v_final_bill.bill_id
      AND item.item_type <> 'electricity'
      AND NOT (
        item.item_type = 'adjustment'
        AND item.description IN ('Electricity', 'Electricity not charged')
      );
  ELSE
    v_period_start := public.cycle_date(v_tenancy.move_in_date, p_move_out_date);
    IF v_period_start > p_move_out_date THEN
      v_period_start := public.cycle_date(
        v_tenancy.move_in_date,
        (p_move_out_date - interval '1 month')::date
      );
    END IF;
    v_period_start := GREATEST(v_period_start, v_tenancy.move_in_date);

    SELECT
      v_tenancy.monthly_rate
      + coalesce(sum(charge.unit_price), 0)
    INTO v_base_total
    FROM (
      SELECT coalesce(
        tenancy_charge.unit_price,
        room_charge.unit_price,
        owner_charge.unit_price
      ) AS unit_price
      FROM (VALUES
        ('water'::public.bill_item_type),
        ('trash'::public.bill_item_type),
        ('wifi'::public.bill_item_type)
      ) AS charge_type(item_type)
      LEFT JOIN public.tenancy_default_charges AS tenancy_charge
        ON tenancy_charge.tenancy_id = v_tenancy.tenancy_id
        AND tenancy_charge.item_type = charge_type.item_type
      LEFT JOIN public.room_default_charges AS room_charge
        ON room_charge.room_id = v_tenancy.room_id
        AND room_charge.item_type = charge_type.item_type
      LEFT JOIN public.owner_default_charges AS owner_charge
        ON owner_charge.owner_id = v_tenancy.owner_id
        AND owner_charge.item_type = charge_type.item_type
      WHERE coalesce(
        tenancy_charge.unit_price,
        room_charge.unit_price,
        owner_charge.unit_price
      ) IS NOT NULL
    ) AS charge;
  END IF;

  SELECT *
  INTO v_item
  FROM public.bill_items
  WHERE bill_id = v_final_bill.bill_id
    AND item_type = 'electricity'
  ORDER BY bill_item_id
  LIMIT 1;

  IF p_electricity_option IS NULL THEN
    RETURN jsonb_build_object(
      'today', v_today,
      'earliestMoveOutDate', v_earliest,
      'moveOutDate', p_move_out_date,
      'billId', CASE WHEN v_final_bill.bill_id IS NULL THEN NULL ELSE v_final_bill.bill_id END,
      'periodStart', v_period_start,
      'periodEnd', p_move_out_date,
      'dueDate', p_move_out_date,
      'baseTotal', coalesce(v_base_total, 0),
      'laterBillsToDelete', v_later_count,
      'requiresElectricityChoice', true,
      'previousReading', CASE WHEN v_last_reading.reading_id IS NULL THEN NULL ELSE jsonb_build_object(
        'value', v_last_reading.reading_value,
        'readingAt', v_last_reading.reading_at
      ) END
    );
  END IF;

  IF p_electricity_option IS NULL
     OR p_electricity_option NOT IN ('reading', 'no_charge') THEN
    RAISE EXCEPTION 'Choose Enter final meter reading or No electricity charge for this bill';
  END IF;

  IF p_electricity_option = 'no_charge' THEN
    IF v_item.bill_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'The final bill already has an electricity reading';
    END IF;
    IF v_final_bill.bill_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.bill_items AS item
      WHERE item.bill_id = v_final_bill.bill_id
        AND item.item_type = 'adjustment'
        AND item.description = 'Electricity'
    ) THEN
      RAISE EXCEPTION 'The final bill already has an electricity charge';
    END IF;
  ELSE
    IF p_reading_value IS NULL
       OR p_reading_value < 0
       OR p_reading_value >= 'Infinity'::numeric
       OR p_reading_value = 'NaN'::numeric THEN
      RAISE EXCEPTION 'Enter a valid nonnegative final meter reading';
    END IF;
    IF p_reading_at IS NULL
       OR p_reading_at < p_move_out_date
       OR p_reading_at > v_today THEN
      RAISE EXCEPTION 'Choose a reading date from the move-out date through today';
    END IF;
    IF v_last_reading.reading_id IS NOT NULL
       AND p_reading_value < v_last_reading.reading_value THEN
      RAISE EXCEPTION 'The final reading cannot be lower than the last saved reading';
    END IF;

    SELECT *
    INTO v_existing_reading
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at = p_reading_at
    LIMIT 1;
    IF FOUND AND v_existing_reading.reading_value <> p_reading_value THEN
      RAISE EXCEPTION 'A different meter reading is already saved for the final reading date';
    END IF;
    IF v_existing_reading.reading_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.bill_items AS item
      WHERE item.end_reading_id = v_existing_reading.reading_id
        AND item.bill_id IS DISTINCT FROM v_final_bill.bill_id
    ) THEN
      RAISE EXCEPTION 'This meter reading is already attached to another bill';
    END IF;

    SELECT *
    INTO v_next_tenancy
    FROM public.tenancy
    WHERE room_id = v_tenancy.room_id
      AND tenancy_id <> v_tenancy.tenancy_id
      AND move_in_date > v_tenancy.move_in_date
    ORDER BY move_in_date, tenancy_id
    LIMIT 1;
    IF FOUND THEN
      SELECT *
      INTO v_next_reading
      FROM public.meter_readings
      WHERE room_id = v_tenancy.room_id
        AND reading_at = v_next_tenancy.move_in_date
      LIMIT 1;
      IF FOUND THEN
        IF p_reading_value > v_next_reading.reading_value THEN
          RAISE EXCEPTION 'The final reading cannot be higher than the next tenant''s move-in reading';
        END IF;
        IF p_reading_at = v_next_tenancy.move_in_date
           AND p_reading_value <> v_next_reading.reading_value THEN
          RAISE EXCEPTION 'The final reading must match the next tenant''s move-in reading';
        END IF;
      END IF;
    END IF;

    SELECT *
    INTO v_previous_reading
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at < p_reading_at
      AND reading_at >= v_tenancy.move_in_date
    ORDER BY reading_at DESC, reading_id DESC
    LIMIT 1;

    IF v_previous_reading.reading_id IS NULL
       AND v_existing_reading.reading_id IS NOT NULL
       AND v_existing_reading.reading_at = v_tenancy.move_in_date THEN
      v_previous_reading := v_existing_reading;
      v_zero_span := true;
    ELSIF v_previous_reading.reading_id IS NULL THEN
      RAISE EXCEPTION 'An opening meter reading for this tenancy is required before billing';
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
    WHERE tenancy.tenancy_id = v_tenancy.tenancy_id;

    IF v_rate IS NULL THEN
      RAISE EXCEPTION 'Set an electricity rate for this tenancy or owner before billing';
    END IF;

    v_units := p_reading_value - v_previous_reading.reading_value;
    v_electricity := v_units * v_rate;

    IF v_item.bill_item_id IS NOT NULL THEN
      IF v_item.end_reading_id IS DISTINCT FROM v_existing_reading.reading_id
         OR v_existing_reading.reading_value <> p_reading_value THEN
        RAISE EXCEPTION 'The final bill already has a different electricity reading';
      END IF;
      v_units := v_item.quantity;
      v_rate := v_item.unit_price;
      v_electricity := v_item.amount;
    END IF;
    IF v_final_bill.bill_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.bill_items AS item
      WHERE item.bill_id = v_final_bill.bill_id
        AND item.item_type = 'adjustment'
        AND item.description = 'Electricity'
        AND v_item.bill_item_id IS NULL
    ) THEN
      RAISE EXCEPTION 'The final bill already has an electricity charge';
    END IF;
    IF v_final_bill.bill_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.bill_items AS item
      WHERE item.bill_id = v_final_bill.bill_id
        AND item.item_type = 'adjustment'
        AND item.description = 'Electricity not charged'
    ) THEN
      RAISE EXCEPTION 'Electricity was not charged on this final bill. This exception cannot be undone.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'today', v_today,
    'earliestMoveOutDate', v_earliest,
    'moveOutDate', p_move_out_date,
    'billId', CASE WHEN v_final_bill.bill_id IS NULL THEN NULL ELSE v_final_bill.bill_id END,
    'periodStart', v_period_start,
    'periodEnd', p_move_out_date,
    'dueDate', p_move_out_date,
    'baseTotal', coalesce(v_base_total, 0),
    'laterBillsToDelete', v_later_count,
    'electricityOption', p_electricity_option,
    'readingValue', CASE WHEN p_electricity_option = 'reading' THEN p_reading_value END,
    'readingAt', CASE WHEN p_electricity_option = 'reading' THEN p_reading_at END,
    'previousReading', CASE
      WHEN v_previous_reading.reading_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'value', v_previous_reading.reading_value,
        'readingAt', v_previous_reading.reading_at
      )
    END,
    'units', CASE WHEN p_electricity_option = 'reading' THEN v_units END,
    'rate', CASE WHEN p_electricity_option = 'reading' THEN v_rate END,
    'electricityCharge', CASE WHEN p_electricity_option = 'reading' THEN v_electricity ELSE 0 END,
    'total', coalesce(v_base_total, 0) + CASE
      WHEN p_electricity_option = 'reading' THEN v_electricity
      ELSE 0
    END,
    'noElectricityCharge', p_electricity_option = 'no_charge',
    'zeroSpan', v_zero_span
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_tenant_move_out(uuid, date, text, numeric, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_tenant_move_out(uuid, date, text, numeric, date)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.archive_tenancy(p_tenancy_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Move-out details are required to archive a tenant';
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_tenancy_with_move_out(
  p_tenancy_id uuid,
  p_move_out_date date,
  p_electricity_option text,
  p_reading_value numeric DEFAULT NULL,
  p_reading_at date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid := auth.uid();
  v_tenancy public.tenancy%ROWTYPE;
  v_preview jsonb;
  v_final_bill public.monthly_bill%ROWTYPE;
  v_reading public.meter_readings%ROWTYPE;
  v_previous public.meter_readings%ROWTYPE;
  v_existing public.meter_readings%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
  v_archive_id uuid;
  v_period_start date;
  v_rate numeric;
  v_units numeric;
  v_zero_span boolean;
  v_bill_id uuid;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_electricity_option IS NULL
     OR p_electricity_option NOT IN ('reading', 'no_charge') THEN
    RAISE EXCEPTION 'Choose Enter final meter reading or No electricity charge for this bill';
  END IF;

  SELECT tenancy.*
  INTO v_tenancy
  FROM public.tenancy AS tenancy
  WHERE tenancy.tenancy_id = p_tenancy_id
    AND tenancy.owner_id = v_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenancy not found or not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || v_tenancy.room_id::text, 0)
  );
  PERFORM 1
  FROM public.monthly_bill
  WHERE tenancy_id = p_tenancy_id
  FOR UPDATE;

  SELECT public.preview_tenant_move_out(
    p_tenancy_id,
    p_move_out_date,
    p_electricity_option,
    p_reading_value,
    p_reading_at
  )
  INTO v_preview;

  v_period_start := (v_preview ->> 'periodStart')::date;
  v_zero_span := coalesce((v_preview ->> 'zeroSpan')::boolean, false);
  v_bill_id := nullif(v_preview ->> 'billId', '')::uuid;

  DELETE FROM public.bill_items
  WHERE bill_id IN (
    SELECT bill_id
    FROM public.monthly_bill
    WHERE tenancy_id = p_tenancy_id
      AND period_start > p_move_out_date
  );

  DELETE FROM public.monthly_bill
  WHERE tenancy_id = p_tenancy_id
    AND period_start > p_move_out_date;

  IF v_bill_id IS NULL THEN
    v_bill_id := public.generate_monthly_bill(
      p_tenancy_id,
      v_period_start,
      p_move_out_date,
      p_move_out_date
    );
  END IF;

  UPDATE public.monthly_bill
  SET
    period_end = p_move_out_date,
    due_date = p_move_out_date,
    updated_at = now()
  WHERE bill_id = v_bill_id;

  SELECT *
  INTO v_final_bill
  FROM public.monthly_bill
  WHERE bill_id = v_bill_id
  FOR UPDATE;

  IF p_electricity_option = 'reading' THEN
    SELECT *
    INTO v_existing
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at = p_reading_at
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.reading_value <> p_reading_value THEN
        RAISE EXCEPTION 'A different meter reading is already saved for the final reading date';
      END IF;
      v_reading := v_existing;
    ELSE
      PERFORM set_config(
        'inkeeper.final_move_out_room_id',
        v_tenancy.room_id::text,
        true
      );
      INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
      VALUES (v_tenancy.room_id, p_reading_value, p_reading_at)
      RETURNING * INTO v_reading;
    END IF;

    SELECT *
    INTO v_item
    FROM public.bill_items
    WHERE bill_id = v_bill_id
      AND item_type = 'electricity'
    ORDER BY bill_item_id
    LIMIT 1;

    IF v_item.bill_item_id IS NULL THEN
      SELECT *
      INTO v_previous
      FROM public.meter_readings
      WHERE room_id = v_tenancy.room_id
        AND reading_at < p_reading_at
        AND reading_at >= v_tenancy.move_in_date
      ORDER BY reading_at DESC, reading_id DESC
      LIMIT 1;

      SELECT coalesce(tenancy_charge.unit_price, owner_charge.unit_price)
      INTO v_rate
      FROM public.tenancy AS tenancy
      LEFT JOIN public.tenancy_default_charges AS tenancy_charge
        ON tenancy_charge.tenancy_id = tenancy.tenancy_id
        AND tenancy_charge.item_type = 'electricity'
      LEFT JOIN public.owner_default_charges AS owner_charge
        ON owner_charge.owner_id = tenancy.owner_id
        AND owner_charge.item_type = 'electricity'
      WHERE tenancy.tenancy_id = p_tenancy_id;

      v_units := p_reading_value - coalesce(v_previous.reading_value, p_reading_value);

      IF v_zero_span OR v_previous.reading_id IS NULL THEN
        INSERT INTO public.bill_items (
          bill_id,
          item_type,
          description,
          quantity,
          unit_price
        )
        VALUES (
          v_bill_id,
          'adjustment',
          'Electricity',
          0,
          v_rate
        );
      ELSE
        PERFORM set_config(
          'inkeeper.final_move_out_bill_id',
          v_bill_id::text,
          true
        );
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
          v_units,
          v_rate,
          v_previous.reading_id,
          v_reading.reading_id
        );
      END IF;
    END IF;
  ELSE
    INSERT INTO public.bill_items (
      bill_id,
      item_type,
      description,
      quantity,
      unit_price
    )
    VALUES (
      v_bill_id,
      'adjustment',
      'Electricity not charged',
      0,
      0
    );
  END IF;

  UPDATE public.tenancy
  SET move_out_date = p_move_out_date
  WHERE tenancy_id = p_tenancy_id;

  SELECT archive_id
  INTO v_archive_id
  FROM public.tenant_archive
  WHERE tenancy_id = p_tenancy_id;
  IF v_archive_id IS NULL THEN
    RAISE EXCEPTION 'The tenant could not be archived';
  END IF;

  IF p_electricity_option = 'reading' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.bill_items AS item
      WHERE item.bill_id = v_bill_id
        AND (
          item.item_type = 'electricity'
          OR (
            item.item_type = 'adjustment'
            AND item.description = 'Electricity'
          )
        )
    ) THEN
      RAISE EXCEPTION 'The final meter reading could not be saved on the final bill';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.bill_items AS item
    WHERE item.bill_id = v_bill_id
      AND item.item_type = 'adjustment'
      AND item.description = 'Electricity not charged'
  ) THEN
    RAISE EXCEPTION 'The no-electricity-charge exception could not be saved';
  END IF;

  RETURN jsonb_build_object(
    'archiveId', v_archive_id,
    'billId', v_bill_id,
    'moveOutDate', p_move_out_date,
    'electricityOption', p_electricity_option,
    'total', (SELECT total_amount FROM public.monthly_bill WHERE bill_id = v_bill_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_tenancy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_tenancy(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.archive_tenancy_with_move_out(
  uuid, date, text, numeric, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_tenancy_with_move_out(
  uuid, date, text, numeric, date
) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_final_move_out_no_charge()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_tenant_bill(
  p_bill_id uuid,
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
  v_sum numeric;
  v_reminder_id uuid;
  v_email text;
  v_has_electricity boolean;
  v_payload jsonb;
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
    RAISE EXCEPTION 'A valid delivery request identifier is required';
  END IF;

  SELECT bill.*
  INTO v_bill
  FROM public.monthly_bill bill
  JOIN public.tenancy tenancy ON tenancy.tenancy_id = bill.tenancy_id
  WHERE bill.bill_id = p_bill_id
    AND tenancy.owner_id = v_owner_id
  FOR UPDATE OF bill;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;
  IF v_bill.billed_at IS NOT NULL OR coalesce(v_bill.is_paid, false)
     OR v_bill.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'This bill is already finalized or paid';
  END IF;

  SELECT coalesce(sum(item.amount), 0)
  INTO v_sum
  FROM public.bill_items item
  WHERE item.bill_id = v_bill.bill_id;

  IF abs(coalesce(v_bill.total_amount, 0) - v_sum) > 0.005 THEN
    RAISE EXCEPTION 'The bill total does not match its itemized charges';
  END IF;

  v_has_electricity := EXISTS (
    SELECT 1
    FROM public.bill_items item
    WHERE item.bill_id = v_bill.bill_id
      AND (
        item.item_type = 'electricity'
        OR (
          item.item_type = 'adjustment'
          AND item.description IN ('Electricity', 'Electricity not charged')
        )
      )
  );

  IF NOT v_has_electricity
     AND v_bill.electricity_roll_forward_to_bill_id IS NOT NULL THEN
    v_has_electricity := EXISTS (
      SELECT 1
      FROM public.monthly_bill target_bill
      JOIN public.bill_items target_item
        ON target_item.bill_id = target_bill.bill_id
       AND target_item.item_type = 'electricity'
      JOIN public.meter_readings start_reading
        ON start_reading.reading_id = target_item.start_reading_id
      JOIN public.meter_readings end_reading
        ON end_reading.reading_id = target_item.end_reading_id
      WHERE target_bill.bill_id = v_bill.electricity_roll_forward_to_bill_id
        AND target_bill.tenancy_id = v_bill.tenancy_id
        AND target_bill.billed_at IS NOT NULL
        AND start_reading.reading_at <= v_bill.period_start
        AND end_reading.reading_at >= v_bill.period_end
    );
  END IF;

  IF NOT v_has_electricity THEN
    RAISE EXCEPTION 'Save an electricity reading before finalizing this bill';
  END IF;

  PERFORM set_config(
    'inkeeper.explicit_finalize_bill_id',
    v_bill.bill_id::text,
    true
  );

  UPDATE public.monthly_bill
  SET billed_at = now()
  WHERE bill_id = v_bill.bill_id;

  INSERT INTO public.bill_reminders (
    bill_id,
    reminder_type,
    reminder_day,
    delivery_status,
    attempt_count,
    attempt_started_at,
    client_request_id
  )
  VALUES (
    v_bill.bill_id,
    'tenant_bill_sent'::public.reminder_type,
    NULL,
    'pending',
    1,
    now(),
    p_request_id
  )
  RETURNING reminder_id INTO v_reminder_id;

  v_payload := private.build_bill_email_payload(v_bill.bill_id);
  v_email := v_payload ->> 'tenantEmail';

  IF v_email IS NULL THEN
    UPDATE public.bill_reminders
    SET
      delivery_status = 'failed',
      retry_at = NULL,
      last_error = 'No email on file for this tenant.',
      sent_at = NULL
    WHERE reminder_id = v_reminder_id;

    RETURN jsonb_build_object(
      'kind', 'no_email',
      'reminderId', v_reminder_id,
      'bill', v_payload
    );
  END IF;

  RETURN jsonb_build_object(
    'kind', 'pending',
    'reminderId', v_reminder_id,
    'bill', v_payload
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_tenant_bill(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_tenant_bill(uuid, text)
  TO authenticated, service_role;