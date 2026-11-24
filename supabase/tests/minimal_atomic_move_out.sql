BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('f2410000-0000-4000-8000-000000000001', 'move-out-owner@example.invalid');

INSERT INTO public.boarding_house (
  boarding_house_id,
  owner_id,
  name,
  address
)
VALUES (
  'f2410000-0000-4000-8000-000000000010',
  'f2410000-0000-4000-8000-000000000001',
  'Move-out test house',
  'Test address'
);

INSERT INTO public.rooms (
  room_id,
  boarding_house_id,
  room_name,
  monthly_rate
)
VALUES
  ('f2410000-0000-4000-8000-000000000020', 'f2410000-0000-4000-8000-000000000010', 'Reading room', 1000),
  ('f2410000-0000-4000-8000-000000000021', 'f2410000-0000-4000-8000-000000000010', 'No charge room', 1000),
  ('f2410000-0000-4000-8000-000000000022', 'f2410000-0000-4000-8000-000000000010', 'Validation room', 1000),
  ('f2410000-0000-4000-8000-000000000023', 'f2410000-0000-4000-8000-000000000010', 'Rollback room', 1000);

INSERT INTO public.owner_default_charges (owner_id, item_type, unit_price)
VALUES
  ('f2410000-0000-4000-8000-000000000001', 'water', 100),
  ('f2410000-0000-4000-8000-000000000001', 'trash', 50),
  ('f2410000-0000-4000-8000-000000000001', 'wifi', 200),
  ('f2410000-0000-4000-8000-000000000001', 'electricity', 10);

INSERT INTO public.tenants (
  tenant_id,
  owner_id,
  name,
  contact_number,
  email_address
)
VALUES
  ('f2410000-0000-4000-8000-000000000030', 'f2410000-0000-4000-8000-000000000001', 'Reading tenant', '09170000001', 'reading@example.invalid'),
  ('f2410000-0000-4000-8000-000000000031', 'f2410000-0000-4000-8000-000000000001', 'No charge tenant', '09170000002', 'no-charge@example.invalid'),
  ('f2410000-0000-4000-8000-000000000032', 'f2410000-0000-4000-8000-000000000001', 'Validation tenant', '09170000003', 'validation@example.invalid'),
  ('f2410000-0000-4000-8000-000000000033', 'f2410000-0000-4000-8000-000000000001', 'Next tenant', '09170000004', 'next@example.invalid'),
  ('f2410000-0000-4000-8000-000000000034', 'f2410000-0000-4000-8000-000000000001', 'Rollback tenant', '09170000005', 'rollback@example.invalid');

INSERT INTO public.tenancy (
  tenancy_id,
  owner_id,
  tenant_id,
  room_id,
  move_in_date
)
VALUES
  ('f2410000-0000-4000-8000-000000000040', 'f2410000-0000-4000-8000-000000000001', 'f2410000-0000-4000-8000-000000000030', 'f2410000-0000-4000-8000-000000000020', (now() AT TIME ZONE 'Asia/Manila')::date - 60),
  ('f2410000-0000-4000-8000-000000000041', 'f2410000-0000-4000-8000-000000000001', 'f2410000-0000-4000-8000-000000000031', 'f2410000-0000-4000-8000-000000000021', (now() AT TIME ZONE 'Asia/Manila')::date - 60),
  ('f2410000-0000-4000-8000-000000000042', 'f2410000-0000-4000-8000-000000000001', 'f2410000-0000-4000-8000-000000000032', 'f2410000-0000-4000-8000-000000000022', (now() AT TIME ZONE 'Asia/Manila')::date - 30),
  ('f2410000-0000-4000-8000-000000000043', 'f2410000-0000-4000-8000-000000000001', 'f2410000-0000-4000-8000-000000000033', 'f2410000-0000-4000-8000-000000000022', (now() AT TIME ZONE 'Asia/Manila')::date - 1),
  ('f2410000-0000-4000-8000-000000000044', 'f2410000-0000-4000-8000-000000000001', 'f2410000-0000-4000-8000-000000000034', 'f2410000-0000-4000-8000-000000000023', (now() AT TIME ZONE 'Asia/Manila')::date - 30);

INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
VALUES
  ('f2410000-0000-4000-8000-000000000020', 1000, (now() AT TIME ZONE 'Asia/Manila')::date - 60),
  ('f2410000-0000-4000-8000-000000000021', 2000, (now() AT TIME ZONE 'Asia/Manila')::date - 60),
  ('f2410000-0000-4000-8000-000000000022', 1000, (now() AT TIME ZONE 'Asia/Manila')::date - 30),
  ('f2410000-0000-4000-8000-000000000022', 1500, (now() AT TIME ZONE 'Asia/Manila')::date - 1),
  ('f2410000-0000-4000-8000-000000000023', 1000, (now() AT TIME ZONE 'Asia/Manila')::date - 30);

DO $single_day_bill$
DECLARE
  v_date date := (now() AT TIME ZONE 'Asia/Manila')::date - 40;
  v_bill_id uuid;
BEGIN
  INSERT INTO public.monthly_bill (
    tenancy_id,
    period_start,
    period_end,
    due_date
  )
  VALUES (
    'f2410000-0000-4000-8000-000000000044',
    v_date,
    v_date,
    v_date
  )
  RETURNING bill_id INTO v_bill_id;

  DELETE FROM public.monthly_bill
  WHERE bill_id = v_bill_id;
END;
$single_day_bill$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'f2410000-0000-4000-8000-000000000001',
  true
);

DO $reading_archive$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_move_out date := v_today - 5;
  v_bill_id uuid;
  v_result jsonb;
BEGIN
  v_bill_id := public.generate_monthly_bill(
    'f2410000-0000-4000-8000-000000000040',
    v_move_out - 20,
    v_move_out + 10,
    v_move_out + 10
  );
  PERFORM public.generate_monthly_bill(
    'f2410000-0000-4000-8000-000000000040',
    v_move_out + 1,
    v_move_out + 30,
    v_move_out + 30
  );

  v_result := public.archive_tenancy_with_move_out(
    'f2410000-0000-4000-8000-000000000040',
    v_move_out,
    'reading',
    1200,
    v_today
  );

  IF (v_result ->> 'billId')::uuid <> v_bill_id THEN
    RAISE EXCEPTION 'The wrong final bill was archived';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.monthly_bill
    WHERE bill_id = v_bill_id
      AND period_end = v_move_out
      AND due_date = v_move_out
      AND total_amount = 3350
  ) THEN
    RAISE EXCEPTION 'The final bill did not retain full charges or end on move-out';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.bill_items
    WHERE bill_id = v_bill_id
      AND item_type = 'electricity'
      AND quantity = 200
      AND amount = 2000
  ) THEN
    RAISE EXCEPTION 'The final reading did not create the electricity charge';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenancy
    WHERE tenancy_id = 'f2410000-0000-4000-8000-000000000040'
      AND move_out_date = v_move_out
      AND status = 'ended'
  ) THEN
    RAISE EXCEPTION 'The tenancy did not archive on the selected date';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.rooms
    WHERE room_id = 'f2410000-0000-4000-8000-000000000020'
      AND NOT is_occupied
  ) THEN
    RAISE EXCEPTION 'The room did not become vacant';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.monthly_bill
    WHERE tenancy_id = 'f2410000-0000-4000-8000-000000000040'
      AND period_start > v_move_out
  ) THEN
    RAISE EXCEPTION 'A removable bill after move-out remained';
  END IF;
  IF (public.finalize_tenant_bill(v_bill_id, 'reading-finalize-request-001') ->> 'kind') IS NULL THEN
    RAISE EXCEPTION 'An archived bill could not be finalized';
  END IF;
END;
$reading_archive$;

DO $no_charge_archive$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_move_out date := v_today - 2;
  v_bill_id uuid;
BEGIN
  v_bill_id := public.generate_monthly_bill(
    'f2410000-0000-4000-8000-000000000041',
    v_move_out - 20,
    v_move_out + 10,
    v_move_out + 10
  );

  PERFORM public.archive_tenancy_with_move_out(
    'f2410000-0000-4000-8000-000000000041',
    v_move_out,
    'no_charge',
    NULL,
    NULL
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.bill_items
    WHERE bill_id = v_bill_id
      AND item_type = 'adjustment'
      AND description = 'Electricity not charged'
      AND quantity = 0
      AND amount = 0
  ) THEN
    RAISE EXCEPTION 'The no-charge exception was not saved';
  END IF;
  IF (
    SELECT total_amount
    FROM public.monthly_bill
    WHERE bill_id = v_bill_id
  ) <> 1350 THEN
    RAISE EXCEPTION 'The no-charge total included electricity';
  END IF;

  BEGIN
    DELETE FROM public.bill_items
    WHERE bill_id = v_bill_id
      AND description = 'Electricity not charged';
    RAISE EXCEPTION 'The no-charge exception was removed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'The no-electricity-charge exception cannot be changed or removed' THEN
      RAISE;
    END IF;
  END;

  IF (public.finalize_tenant_bill(v_bill_id, 'no-charge-finalize-request-001') ->> 'kind') IS NULL THEN
    RAISE EXCEPTION 'The archived no-charge bill could not be finalized';
  END IF;
END;
$no_charge_archive$;

DO $validation$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_bill_id uuid;
BEGIN
  v_bill_id := public.generate_monthly_bill(
    'f2410000-0000-4000-8000-000000000042',
    v_today - 20,
    v_today - 10,
    v_today - 10
  );

  BEGIN
    INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
    VALUES (
      'f2410000-0000-4000-8000-000000000022',
      1500,
      v_today
    );
    RAISE EXCEPTION 'An ordinary second cycle reading was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'A meter reading already exists for this billing cycle' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.archive_tenancy_with_move_out(
      'f2410000-0000-4000-8000-000000000042',
      v_today + 1,
      'reading',
      1500,
      v_today
    );
    RAISE EXCEPTION 'A future move-out date was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'The move-out date cannot be in the future' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.archive_tenancy_with_move_out(
      'f2410000-0000-4000-8000-000000000042',
      v_today - 1,
      'reading',
      1499,
      v_today
    );
    RAISE EXCEPTION 'A lower final reading was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'The final reading cannot be lower than the last saved reading' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.archive_tenancy_with_move_out(
      'f2410000-0000-4000-8000-000000000042',
      v_today - 1,
      'reading',
      1600,
      v_today
    );
    RAISE EXCEPTION 'A reading above the next tenant move-in reading was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'The final reading cannot be higher than the next tenant''s move-in reading' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.archive_tenancy_with_move_out(
      'f2410000-0000-4000-8000-000000000042',
      v_today - 1,
      'reading',
      1500,
      v_today + 1
    );
    RAISE EXCEPTION 'A future final reading date was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Choose a reading date from the move-out date through today' THEN
      RAISE;
    END IF;
  END;

  PERFORM public.generate_monthly_bill(
    'f2410000-0000-4000-8000-000000000042',
    v_today + 1,
    v_today + 30,
    v_today + 30
  );
  PERFORM public.carry_forward_bill_electricity(v_bill_id);

  BEGIN
    PERFORM public.archive_tenancy_with_move_out(
      'f2410000-0000-4000-8000-000000000042',
      v_today - 1,
      'reading',
      1500,
      v_today
    );
    RAISE EXCEPTION 'A carry-forward chain after move-out was removed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE
      'A bill starting % cannot be removed because it is finalized, paid, has a meter reading, or is in a carry-forward chain. Resolve it before archiving.' THEN
      RAISE;
    END IF;
  END;
END;
$validation$;

RESET ROLE;

CREATE FUNCTION pg_temp.fail_move_out_archive()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Forced archive failure';
END;
$function$;

CREATE TRIGGER fail_move_out_archive
  AFTER INSERT ON public.tenant_archive
  FOR EACH ROW
  EXECUTE FUNCTION pg_temp.fail_move_out_archive();

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'f2410000-0000-4000-8000-000000000001',
  true
);

DO $rollback$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_bill_id uuid;
  v_initial_total numeric;
BEGIN
  v_bill_id := public.generate_monthly_bill(
    'f2410000-0000-4000-8000-000000000044',
    v_today - 20,
    v_today + 10,
    v_today + 10
  );
  SELECT total_amount INTO v_initial_total
  FROM public.monthly_bill
  WHERE bill_id = v_bill_id;

  BEGIN
    PERFORM public.archive_tenancy_with_move_out(
      'f2410000-0000-4000-8000-000000000044',
      v_today - 2,
      'reading',
      1200,
      v_today
    );
    RAISE EXCEPTION 'The forced failure did not stop archive';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Forced archive failure' THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.tenancy
    WHERE tenancy_id = 'f2410000-0000-4000-8000-000000000044'
      AND move_out_date IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.tenant_archive
    WHERE tenancy_id = 'f2410000-0000-4000-8000-000000000044'
  ) OR EXISTS (
    SELECT 1
    FROM public.meter_readings
    WHERE room_id = 'f2410000-0000-4000-8000-000000000023'
      AND reading_at = v_today
  ) THEN
    RAISE EXCEPTION 'A failed move-out retained tenancy, archive, or reading changes';
  END IF;
  IF (
    SELECT total_amount
    FROM public.monthly_bill
    WHERE bill_id = v_bill_id
  ) IS DISTINCT FROM v_initial_total THEN
    RAISE EXCEPTION 'A failed move-out retained bill changes';
  END IF;
END;
$rollback$;

RESET ROLE;

DROP TRIGGER fail_move_out_archive ON public.tenant_archive;

ROLLBACK;
