-- The one-reading-per-cycle check counted the tenancy's opening reading
-- (taken on move-in day), so the first bill's present reading was rejected.
-- Readings taken on a tenancy boundary date no longer count toward the cycle.
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
        AND NOT EXISTS (
          SELECT 1
          FROM public.tenancy t
          WHERE t.room_id = new.room_id
            AND (t.move_in_date = existing.reading_at
                 OR t.move_out_date = existing.reading_at)
        )
    ) THEN
      RAISE EXCEPTION 'A meter reading already exists for this billing cycle';
    END IF;
  END IF;

  RETURN new;
END;
$function$;
