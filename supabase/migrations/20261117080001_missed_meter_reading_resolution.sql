ALTER TABLE public.monthly_bill
  ADD COLUMN electricity_roll_forward_to_bill_id uuid
    REFERENCES public.monthly_bill(bill_id) ON DELETE RESTRICT,
  ADD CONSTRAINT monthly_bill_electricity_roll_forward_not_self
    CHECK (
      electricity_roll_forward_to_bill_id IS NULL
      OR electricity_roll_forward_to_bill_id <> bill_id
    );

CREATE INDEX monthly_bill_electricity_roll_forward_to_idx
  ON public.monthly_bill(electricity_roll_forward_to_bill_id)
  WHERE electricity_roll_forward_to_bill_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.carry_forward_bill_electricity(
  p_source_bill_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source public.monthly_bill%ROWTYPE;
  v_target public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
  v_electricity_item public.bill_items%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_target_bill_id uuid;
  v_completed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT * INTO v_source
  FROM public.monthly_bill
  WHERE bill_id = p_source_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_source.tenancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill tenancy not found or not authorized';
  END IF;

  IF v_source.electricity_roll_forward_to_bill_id IS NOT NULL THEN
    v_target_bill_id := v_source.electricity_roll_forward_to_bill_id;
  ELSE
    SELECT bill_id INTO v_target_bill_id
    FROM public.monthly_bill
    WHERE tenancy_id = v_source.tenancy_id
      AND period_start > v_source.period_end
    ORDER BY period_start
    LIMIT 1;
  END IF;

  IF v_target_bill_id IS NULL THEN
    RAISE EXCEPTION 'There is no later generated bill to receive this electricity usage';
  END IF;

  SELECT * INTO v_target
  FROM public.monthly_bill
  WHERE bill_id = v_target_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The later bill could not be found';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || v_tenancy.room_id::text, 0)
  );

  SELECT * INTO v_source
  FROM public.monthly_bill
  WHERE bill_id = p_source_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;

  IF v_target.tenancy_id <> v_source.tenancy_id
     OR v_target.period_start <= v_source.period_end THEN
    RAISE EXCEPTION 'Carry-forward must target a later bill for the same tenancy';
  END IF;

  IF v_source.electricity_roll_forward_to_bill_id IS NOT NULL
     AND v_source.electricity_roll_forward_to_bill_id <> v_target.bill_id THEN
    RAISE EXCEPTION 'This bill is already linked to a different carry-forward bill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bill_items
    WHERE bill_id = v_source.bill_id
      AND (
        item_type = 'electricity'
        OR (item_type = 'adjustment' AND description = 'Electricity')
      )
  ) THEN
    RAISE EXCEPTION 'This bill already has an electricity charge';
  END IF;

  SELECT * INTO v_electricity_item
  FROM public.bill_items
  WHERE bill_id = v_target.bill_id
    AND item_type = 'electricity'
  ORDER BY bill_item_id
  LIMIT 1;

  IF v_electricity_item.bill_item_id IS NOT NULL THEN
    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE reading_id = v_electricity_item.start_reading_id;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE reading_id = v_electricity_item.end_reading_id;

    IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL
       OR v_start.reading_at > v_source.period_start
       OR v_end.reading_at < v_source.period_end THEN
      RAISE EXCEPTION 'The later bill does not contain the full missed-period reading interval';
    END IF;
    v_completed := true;
  ELSIF EXISTS (
    SELECT 1
    FROM public.bill_items
    WHERE bill_id = v_target.bill_id
      AND item_type = 'adjustment'
      AND description = 'Electricity'
  ) THEN
    RAISE EXCEPTION 'The later bill already has a manual electricity charge';
  ELSIF v_target.billed_at IS NOT NULL OR coalesce(v_target.is_paid, false)
        OR v_target.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'The later bill is finalized but does not contain this missed-period usage';
  ELSE
    IF v_source.billed_at IS NOT NULL
       OR coalesce(v_source.is_paid, false)
       OR v_source.paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'An issued or paid bill cannot be changed by carry-forward';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.meter_readings
      WHERE room_id = v_tenancy.room_id
        AND reading_at >= v_tenancy.move_in_date
        AND reading_at <= v_source.period_start
    ) THEN
      RAISE EXCEPTION 'An opening reading before this bill period is required for carry-forward';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.meter_readings
      WHERE room_id = v_tenancy.room_id
        AND reading_at > v_source.period_start
        AND reading_at <= v_source.period_end
    ) THEN
      RAISE EXCEPTION 'A reading already exists in this bill period. Use late reading instead';
    END IF;
  END IF;

  IF v_source.billed_at IS NOT NULL
     OR coalesce(v_source.is_paid, false)
     OR v_source.paid_at IS NOT NULL THEN
    IF v_source.electricity_roll_forward_to_bill_id = v_target.bill_id
       AND v_completed THEN
      RETURN jsonb_build_object(
        'targetBillId', v_target.bill_id,
        'targetPeriodStart', v_target.period_start,
        'status', 'completed'
      );
    END IF;
    RAISE EXCEPTION 'An issued or paid bill cannot be changed by carry-forward';
  END IF;

  UPDATE public.monthly_bill
  SET electricity_roll_forward_to_bill_id = v_target.bill_id,
      billed_at = CASE WHEN v_completed THEN now() ELSE billed_at END
  WHERE bill_id = v_source.bill_id;

  RETURN jsonb_build_object(
    'targetBillId', v_target.bill_id,
    'targetPeriodStart', v_target.period_start,
    'status', CASE WHEN v_completed THEN 'completed' ELSE 'pending' END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_bill_electricity_roll_forward(
  p_source_bill_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source public.monthly_bill%ROWTYPE;
  v_target public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT * INTO v_source
  FROM public.monthly_bill
  WHERE bill_id = p_source_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;
  IF v_source.electricity_roll_forward_to_bill_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_source.tenancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill tenancy not found or not authorized';
  END IF;

  SELECT * INTO v_target
  FROM public.monthly_bill
  WHERE bill_id = v_source.electricity_roll_forward_to_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The later bill could not be found';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || v_tenancy.room_id::text, 0)
  );

  SELECT * INTO v_source
  FROM public.monthly_bill
  WHERE bill_id = p_source_bill_id
  FOR UPDATE;

  IF v_source.billed_at IS NOT NULL
     OR coalesce(v_source.is_paid, false)
     OR v_source.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'A completed, issued, or paid carry-forward cannot be cancelled';
  END IF;

  IF v_target.billed_at IS NOT NULL
     OR coalesce(v_target.is_paid, false)
     OR v_target.paid_at IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.bill_items
       WHERE bill_id = v_target.bill_id
         AND item_type = 'electricity'
     )
     OR EXISTS (
       SELECT 1
       FROM public.meter_readings
       WHERE room_id = v_tenancy.room_id
         AND reading_at > v_source.period_end
     ) THEN
    RAISE EXCEPTION 'A later reading already exists; this carry-forward cannot be cancelled safely';
  END IF;

  UPDATE public.monthly_bill
  SET electricity_roll_forward_to_bill_id = NULL
  WHERE bill_id = v_source.bill_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_electricity_roll_forward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_room_id uuid;
  v_tenancy public.tenancy%ROWTYPE;
  v_target public.monthly_bill%ROWTYPE;
  v_target_item public.bill_items%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_source public.monthly_bill%ROWTYPE;
BEGIN
  IF new.electricity_roll_forward_to_bill_id
       IS DISTINCT FROM old.electricity_roll_forward_to_bill_id THEN
    IF old.billed_at IS NOT NULL
       OR coalesce(old.is_paid, false)
       OR old.paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'A finalized or paid bill cannot change its carry-forward';
    END IF;

    IF old.electricity_roll_forward_to_bill_id IS NOT NULL
       AND new.electricity_roll_forward_to_bill_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cancel the existing carry-forward before selecting another bill';
    END IF;

    IF new.electricity_roll_forward_to_bill_id IS NULL THEN
      SELECT * INTO v_target
      FROM public.monthly_bill
      WHERE bill_id = old.electricity_roll_forward_to_bill_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The carry-forward bill could not be found';
      END IF;

      IF v_target.billed_at IS NOT NULL
         OR coalesce(v_target.is_paid, false)
         OR v_target.paid_at IS NOT NULL
         OR EXISTS (
           SELECT 1
           FROM public.bill_items
           WHERE bill_id = v_target.bill_id
             AND item_type = 'electricity'
         )
         OR EXISTS (
           SELECT 1
           FROM public.meter_readings
           WHERE room_id = (
             SELECT room_id
             FROM public.tenancy
             WHERE tenancy_id = old.tenancy_id
           )
             AND reading_at > old.period_end
         ) THEN
        RAISE EXCEPTION 'A later reading already exists; this carry-forward cannot be cancelled safely';
      END IF;
    ELSE
      SELECT * INTO v_target
      FROM public.monthly_bill
      WHERE bill_id = new.electricity_roll_forward_to_bill_id
        AND tenancy_id = new.tenancy_id;
      IF NOT FOUND OR v_target.period_start <= new.period_end THEN
        RAISE EXCEPTION 'Carry-forward target must be a later bill for the same tenancy';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.bill_items
        WHERE bill_id = new.bill_id
          AND (
            item_type = 'electricity'
            OR (item_type = 'adjustment' AND description = 'Electricity')
          )
      ) THEN
        RAISE EXCEPTION 'A bill with an electricity charge cannot be carried forward';
      END IF;

      SELECT * INTO v_target_item
      FROM public.bill_items
      WHERE bill_id = v_target.bill_id
        AND item_type = 'electricity'
      ORDER BY bill_item_id
      LIMIT 1;

      IF v_target_item.bill_item_id IS NOT NULL THEN
        SELECT * INTO v_start
        FROM public.meter_readings
        WHERE reading_id = v_target_item.start_reading_id;
        SELECT * INTO v_end
        FROM public.meter_readings
        WHERE reading_id = v_target_item.end_reading_id;
        IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL
           OR v_start.reading_at > new.period_start
           OR v_end.reading_at < new.period_end THEN
          RAISE EXCEPTION 'The later bill reading interval does not cover this bill period';
        END IF;
        new.billed_at := now();
      ELSE
        IF EXISTS (
          SELECT 1
          FROM public.bill_items
          WHERE bill_id = v_target.bill_id
            AND item_type = 'adjustment'
            AND description = 'Electricity'
        ) THEN
          RAISE EXCEPTION 'The later bill already has a manual electricity charge';
        END IF;
        IF v_target.billed_at IS NOT NULL
           OR coalesce(v_target.is_paid, false)
           OR v_target.paid_at IS NOT NULL THEN
          RAISE EXCEPTION 'The later bill is finalized but does not contain this missed-period usage';
        END IF;

        SELECT * INTO v_tenancy
        FROM public.tenancy
        WHERE tenancy_id = new.tenancy_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Bill tenancy not found or not authorized';
        END IF;
        v_room_id := v_tenancy.room_id;

        IF NOT EXISTS (
          SELECT 1
          FROM public.meter_readings
          WHERE room_id = v_room_id
            AND reading_at >= v_tenancy.move_in_date
            AND reading_at <= new.period_start
        ) THEN
          RAISE EXCEPTION 'An opening meter reading before this bill period is required for carry-forward';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM public.meter_readings
          WHERE room_id = v_room_id
            AND reading_at > new.period_start
            AND reading_at <= new.period_end
        ) THEN
          RAISE EXCEPTION 'A reading already exists in this bill period. Use late reading instead';
        END IF;
      END IF;
    END IF;
  END IF;

  IF (new.paid_at IS NOT NULL OR coalesce(new.is_paid, false))
     AND new.billed_at IS NULL
     AND (
       new.electricity_roll_forward_to_bill_id IS NOT NULL
       OR old.electricity_roll_forward_to_bill_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'This bill cannot be marked paid until its carry-forward is completed';
  END IF;

  IF old.billed_at IS NOT NULL OR new.billed_at IS NULL THEN
    RETURN new;
  END IF;

  IF new.electricity_roll_forward_to_bill_id IS NOT NULL THEN
    SELECT * INTO v_target
    FROM public.monthly_bill
    WHERE bill_id = new.electricity_roll_forward_to_bill_id
      AND tenancy_id = new.tenancy_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Carry-forward target must belong to the same tenancy';
    END IF;

    SELECT * INTO v_target_item
    FROM public.bill_items
    WHERE bill_id = v_target.bill_id
      AND item_type = 'electricity'
    ORDER BY bill_item_id
    LIMIT 1;
    IF v_target_item.bill_item_id IS NULL THEN
      RAISE EXCEPTION 'The later bill must contain the rolled-forward electricity charge before this bill is issued';
    END IF;

    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE reading_id = v_target_item.start_reading_id;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE reading_id = v_target_item.end_reading_id;
    IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL
       OR v_start.reading_at > new.period_start
       OR v_end.reading_at < new.period_end THEN
      RAISE EXCEPTION 'The later bill reading interval does not cover this bill period';
    END IF;
    RETURN new;
  END IF;

  SELECT room_id INTO v_room_id
  FROM public.tenancy
  WHERE tenancy_id = new.tenancy_id;

  IF EXISTS (
    SELECT 1
    FROM public.monthly_bill older
    WHERE older.tenancy_id = new.tenancy_id
      AND older.period_end < new.period_start
      AND older.billed_at IS NULL
      AND NOT coalesce(older.is_paid, false)
      AND older.paid_at IS NULL
      AND older.electricity_roll_forward_to_bill_id IS DISTINCT FROM new.bill_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.bill_items older_item
        WHERE older_item.bill_id = older.bill_id
          AND (
            older_item.item_type = 'electricity'
            OR (
              older_item.item_type = 'adjustment'
              AND older_item.description = 'Electricity'
            )
          )
      )
      AND EXISTS (
        SELECT 1
        FROM public.meter_readings
        WHERE room_id = v_room_id
      )
  ) THEN
    RAISE EXCEPTION 'Resolve earlier electricity readings with a late reading or explicit carry-forward before issuing this bill';
  END IF;

  FOR v_source IN
    SELECT *
    FROM public.monthly_bill
    WHERE electricity_roll_forward_to_bill_id = new.bill_id
      AND billed_at IS NULL
      AND NOT coalesce(is_paid, false)
      AND paid_at IS NULL
    ORDER BY period_start
    FOR UPDATE
  LOOP
    SELECT * INTO v_target_item
    FROM public.bill_items
    WHERE bill_id = new.bill_id
      AND item_type = 'electricity'
    ORDER BY bill_item_id
    LIMIT 1;
    IF v_target_item.bill_item_id IS NULL THEN
      RAISE EXCEPTION 'The later bill must contain the rolled-forward electricity charge before the earlier bill is issued';
    END IF;

    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE reading_id = v_target_item.start_reading_id;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE reading_id = v_target_item.end_reading_id;
    IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL
       OR v_start.reading_at > v_source.period_start
       OR v_end.reading_at < v_source.period_end THEN
      RAISE EXCEPTION 'The later bill reading interval does not cover a carried-forward period';
    END IF;

    UPDATE public.monthly_bill
    SET billed_at = new.billed_at
    WHERE bill_id = v_source.bill_id;
  END LOOP;

  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS guard_electricity_roll_forward_before_issue
  ON public.monthly_bill;
CREATE TRIGGER guard_electricity_roll_forward_before_issue
  BEFORE UPDATE OF billed_at, paid_at, is_paid, electricity_roll_forward_to_bill_id
  ON public.monthly_bill
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_electricity_roll_forward();

REVOKE ALL ON FUNCTION public.carry_forward_bill_electricity(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carry_forward_bill_electricity(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_bill_electricity_roll_forward(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_bill_electricity_roll_forward(uuid)
  TO authenticated, service_role;