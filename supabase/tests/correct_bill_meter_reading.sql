-- Run only against an isolated test database after applying all migrations.
-- The transaction is rolled back so the fixture cannot affect existing data.
BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  (
    'd1000000-0000-4000-8000-000000000001',
    'meter-correction-owner@example.invalid'
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    'meter-correction-other@example.invalid'
  );

INSERT INTO public.owner_default_charges (owner_id, item_type, unit_price)
VALUES
  ('d1000000-0000-4000-8000-000000000001', 'electricity', 10),
  ('d1000000-0000-4000-8000-000000000001', 'water', 100);

INSERT INTO public.boarding_house (boarding_house_id, owner_id, name, address)
VALUES (
  'd1000000-0000-4000-8000-000000000010',
  'd1000000-0000-4000-8000-000000000001',
  'Correction house',
  'Test address'
);

INSERT INTO public.rooms (room_id, boarding_house_id, room_name, monthly_rate)
VALUES
  (
    'd1000000-0000-4000-8000-000000000020',
    'd1000000-0000-4000-8000-000000000010',
    'Room 3',
    3000
  ),
  (
    'd1000000-0000-4000-8000-000000000021',
    'd1000000-0000-4000-8000-000000000010',
    'Move-in room',
    3000
  ),
  (
    'd1000000-0000-4000-8000-000000000022',
    'd1000000-0000-4000-8000-000000000010',
    'Initial room',
    3000
  );

INSERT INTO public.tenants (tenant_id, owner_id, name, id_photo_url)
VALUES
  (
    'd1000000-0000-4000-8000-000000000030',
    'd1000000-0000-4000-8000-000000000001',
    'Maria Santos',
    'correction-main-id'
  ),
  (
    'd1000000-0000-4000-8000-000000000031',
    'd1000000-0000-4000-8000-000000000001',
    'Move-in Tenant',
    'correction-movein-id'
  ),
  (
    'd1000000-0000-4000-8000-000000000032',
    'd1000000-0000-4000-8000-000000000001',
    'Initial Tenant',
    'correction-initial-id'
  );

INSERT INTO public.tenancy (
  tenancy_id,
  owner_id,
  tenant_id,
  room_id,
  move_in_date,
  agreement_photo_url
)
VALUES
  (
    'd1000000-0000-4000-8000-000000000040',
    'd1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000030',
    'd1000000-0000-4000-8000-000000000020',
    current_date - 40,
    'correction-main-agreement'
  ),
  (
    'd1000000-0000-4000-8000-000000000041',
    'd1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000031',
    'd1000000-0000-4000-8000-000000000021',
    current_date - 20,
    'correction-movein-agreement'
  ),
  (
    'd1000000-0000-4000-8000-000000000042',
    'd1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000032',
    'd1000000-0000-4000-8000-000000000022',
    current_date - 10,
    'correction-initial-agreement'
  );

INSERT INTO public.meter_readings (reading_id, room_id, reading_value, reading_at)
VALUES
  (
    'd1000000-0000-4000-8000-000000000050',
    'd1000000-0000-4000-8000-000000000020',
    1000,
    current_date - 40
  ),
  (
    'd1000000-0000-4000-8000-000000000051',
    'd1000000-0000-4000-8000-000000000020',
    1070,
    current_date - 1
  ),
  (
    'd1000000-0000-4000-8000-000000000052',
    'd1000000-0000-4000-8000-000000000021',
    500,
    current_date - 25
  ),
  (
    'd1000000-0000-4000-8000-000000000053',
    'd1000000-0000-4000-8000-000000000021',
    510,
    current_date - 20
  ),
  (
    'd1000000-0000-4000-8000-000000000054',
    'd1000000-0000-4000-8000-000000000022',
    600,
    current_date - 30
  );

INSERT INTO public.monthly_bill (
  bill_id,
  tenancy_id,
  period_start,
  period_end,
  due_date
)
VALUES
  (
    'd1000000-0000-4000-8000-000000000060',
    'd1000000-0000-4000-8000-000000000040',
    current_date - 40,
    current_date,
    current_date + 5
  ),
  (
    'd1000000-0000-4000-8000-000000000061',
    'd1000000-0000-4000-8000-000000000040',
    current_date + 1,
    current_date + 30,
    current_date + 35
  ),
  (
    'd1000000-0000-4000-8000-000000000062',
    'd1000000-0000-4000-8000-000000000041',
    current_date - 20,
    current_date,
    current_date + 5
  ),
  (
    'd1000000-0000-4000-8000-000000000063',
    'd1000000-0000-4000-8000-000000000042',
    current_date - 10,
    current_date,
    current_date + 5
  );

INSERT INTO public.bill_items (bill_item_id, bill_id, item_type, unit_price)
VALUES
  (
    'd1000000-0000-4000-8000-000000000070',
    'd1000000-0000-4000-8000-000000000060',
    'rent',
    3000
  ),
  (
    'd1000000-0000-4000-8000-000000000071',
    'd1000000-0000-4000-8000-000000000060',
    'water',
    100
  ),
  (
    'd1000000-0000-4000-8000-000000000072',
    'd1000000-0000-4000-8000-000000000061',
    'rent',
    3000
  );

INSERT INTO public.bill_items (
  bill_item_id,
  bill_id,
  item_type,
  quantity,
  unit_price,
  start_reading_id,
  end_reading_id
)
VALUES (
  'd1000000-0000-4000-8000-000000000073',
  'd1000000-0000-4000-8000-000000000060',
  'electricity',
  70,
  10,
  'd1000000-0000-4000-8000-000000000050',
  'd1000000-0000-4000-8000-000000000051'
);

ALTER TABLE public.bill_items DISABLE TRIGGER electricity_quantity;
INSERT INTO public.bill_items (
  bill_item_id,
  bill_id,
  item_type,
  quantity,
  unit_price,
  start_reading_id,
  end_reading_id
)
VALUES
  (
    'd1000000-0000-4000-8000-000000000074',
    'd1000000-0000-4000-8000-000000000062',
    'electricity',
    10,
    10,
    'd1000000-0000-4000-8000-000000000052',
    'd1000000-0000-4000-8000-000000000053'
  ),
  (
    'd1000000-0000-4000-8000-000000000075',
    'd1000000-0000-4000-8000-000000000063',
    'electricity',
    0,
    10,
    'd1000000-0000-4000-8000-000000000054',
    'd1000000-0000-4000-8000-000000000054'
  );
ALTER TABLE public.bill_items ENABLE TRIGGER electricity_quantity;

DO $fixture$
BEGIN
  IF (
    SELECT total_amount
    FROM public.monthly_bill
    WHERE bill_id = 'd1000000-0000-4000-8000-000000000060'
  ) <> 3800 THEN
    RAISE EXCEPTION 'Fixture total is not 3800';
  END IF;
END;
$fixture$;

CREATE TEMP TABLE correction_test_notifications AS
SELECT
  (SELECT count(*) FROM public.notifications) AS notification_count_before,
  (
    SELECT count(*)
    FROM public.bill_reminders
    WHERE bill_id = 'd1000000-0000-4000-8000-000000000060'
  ) AS email_count_before,
  (
    SELECT reading_at
    FROM public.meter_readings
    WHERE reading_id = 'd1000000-0000-4000-8000-000000000051'
  ) AS reading_date_before;

UPDATE public.owner_default_charges
SET unit_price = 99
WHERE owner_id = 'd1000000-0000-4000-8000-000000000001'
  AND item_type = 'electricity';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);

DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.correct_bill_meter_reading(
    'd1000000-0000-4000-8000-000000000060',
    1080,
    'correction-request-0001'
  );

  IF NOT coalesce((v_result ->> 'corrected')::boolean, false)
     OR coalesce((v_result ->> 'alreadyApplied')::boolean, true)
     OR (v_result ->> 'oldValue')::numeric <> 1070
     OR (v_result ->> 'newValue')::numeric <> 1080
     OR (v_result ->> 'usage')::numeric <> 80
     OR (v_result ->> 'rate')::numeric <> 10
     OR (v_result ->> 'electricityCharge')::numeric <> 800
     OR (v_result ->> 'totalAmount')::numeric <> 3900 THEN
    RAISE EXCEPTION 'Correction result did not preserve the saved bill rate: %', v_result;
  END IF;

  v_result := public.correct_bill_meter_reading(
    'd1000000-0000-4000-8000-000000000060',
    1080,
    'correction-request-0001'
  );
  IF NOT coalesce((v_result ->> 'alreadyApplied')::boolean, false) THEN
    RAISE EXCEPTION 'The repeated request was not returned as already applied';
  END IF;

  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1085,
      'correction-request-0001'
    );
    RAISE EXCEPTION 'Reused request unexpectedly changed the value';
  EXCEPTION WHEN SQLSTATE 'IK00D' THEN
    IF SQLERRM <> 'This correction request was already used for a different change' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1080,
      'correction-request-0002'
    );
    RAISE EXCEPTION 'Same-value correction unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK014' THEN
    IF SQLERRM <> 'The new reading must be different from the saved reading' THEN
      RAISE;
    END IF;
  END;
END;
$test$;

RESET ROLE;

DO $assert$
BEGIN
  IF (
    SELECT reading_value
    FROM public.meter_readings
    WHERE reading_id = 'd1000000-0000-4000-8000-000000000051'
  ) <> 1080 THEN
    RAISE EXCEPTION 'Corrected meter reading was not stored';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bill_items
    WHERE bill_item_id = 'd1000000-0000-4000-8000-000000000073'
      AND quantity = 80
      AND unit_price = 10
      AND amount = 800
  ) THEN
    RAISE EXCEPTION 'Electricity item was not recalculated with the saved rate';
  END IF;

  IF (
    SELECT count(*)
    FROM public.bill_meter_reading_corrections
    WHERE bill_id = 'd1000000-0000-4000-8000-000000000060'
  ) <> 1 THEN
    RAISE EXCEPTION 'Double submit created more than one audit row';
  END IF;

  IF (
    SELECT count(*)
    FROM public.notifications
  ) <> (
    SELECT notification_count_before
    FROM correction_test_notifications
  ) THEN
    RAISE EXCEPTION 'Correction created an owner notification';
  END IF;

  IF (
    SELECT count(*)
    FROM public.bill_reminders
    WHERE bill_id = 'd1000000-0000-4000-8000-000000000060'
  ) <> (
    SELECT email_count_before
    FROM correction_test_notifications
  ) THEN
    RAISE EXCEPTION 'Correction created a bill email delivery record';
  END IF;

  IF (
    SELECT reading_at
    FROM public.meter_readings
    WHERE reading_id = 'd1000000-0000-4000-8000-000000000051'
  ) IS DISTINCT FROM (
    SELECT reading_date_before
    FROM correction_test_notifications
  ) THEN
    RAISE EXCEPTION 'Correction changed the reading date';
  END IF;
END;
$assert$;

-- Direct table edits must not be a bypass for the correction operation.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $direct$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.meter_readings
  SET reading_value = 2000
  WHERE reading_id = 'd1000000-0000-4000-8000-000000000051';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'An owner directly updated a meter reading';
  END IF;

  UPDATE public.bill_items
  SET quantity = 999
  WHERE bill_item_id = 'd1000000-0000-4000-8000-000000000073';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'An owner directly updated an electricity item';
  END IF;
END;
$direct$;
RESET ROLE;

DO $generated_amount$
DECLARE
  v_generated text;
  v_expression text;
BEGIN
  SELECT is_generated, generation_expression
  INTO v_generated, v_expression
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'bill_items'
    AND column_name = 'amount';

  IF v_generated <> 'ALWAYS'
     OR v_expression IS DISTINCT FROM '(quantity * unit_price)' THEN
    RAISE EXCEPTION 'bill_items.amount is not generated as quantity * unit_price';
  END IF;

  BEGIN
    UPDATE public.bill_items
    SET amount = 9999
    WHERE bill_item_id = 'd1000000-0000-4000-8000-000000000073';
    RAISE EXCEPTION 'Generated amount accepted a direct value';
  EXCEPTION WHEN SQLSTATE '428C9' THEN
    NULL;
  END;
END;
$generated_amount$;

-- Negative values are refused.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $negative$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      -1,
      'correction-request-negative'
    );
    RAISE EXCEPTION 'Negative reading unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK008' THEN
    NULL;
  END;
END;
$negative$;
RESET ROLE;

-- A different signed-in owner cannot correct this bill.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000002',
  true
);
DO $unauthorized$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1090,
      'correction-request-unauthorized'
    );
    RAISE EXCEPTION 'Unauthorized correction unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK010' THEN
    NULL;
  END;
END;
$unauthorized$;
RESET ROLE;

-- Lower-than-previous values are refused.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $lower$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      999,
      'correction-request-lower'
    );
    RAISE EXCEPTION 'Lower reading unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK009' THEN
    IF SQLERRM <> 'The new reading cannot be lower than the previous reading.' THEN
      RAISE;
    END IF;
  END;
END;
$lower$;
RESET ROLE;

-- A later reading blocks the earlier bill.
INSERT INTO public.meter_readings (reading_id, room_id, reading_value, reading_at)
VALUES (
  'd1000000-0000-4000-8000-000000000055',
  'd1000000-0000-4000-8000-000000000020',
  1200,
  current_date
);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $later$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1090,
      'correction-request-later'
    );
    RAISE EXCEPTION 'Correction with a later reading unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK003' THEN
    IF SQLERRM <> 'A later reading exists. Only the latest reading can be corrected.' THEN
      RAISE;
    END IF;
  END;
END;
$later$;
RESET ROLE;
DELETE FROM public.meter_readings
WHERE reading_id = 'd1000000-0000-4000-8000-000000000055';

-- Pending carry-forward source and target bills are blocked.
UPDATE public.monthly_bill
SET electricity_roll_forward_to_bill_id =
  'd1000000-0000-4000-8000-000000000061'
WHERE bill_id = 'd1000000-0000-4000-8000-000000000060';
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $carry_source$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1090,
      'correction-request-carry'
    );
    RAISE EXCEPTION 'Carry-forward source unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK004' THEN
    IF SQLERRM <> 'This reading is part of a carry-forward and cannot be changed.' THEN
      RAISE;
    END IF;
  END;
END;
$carry_source$;
RESET ROLE;
UPDATE public.monthly_bill
SET electricity_roll_forward_to_bill_id = NULL
WHERE bill_id = 'd1000000-0000-4000-8000-000000000060';

INSERT INTO public.monthly_bill (
  bill_id,
  tenancy_id,
  period_start,
  period_end,
  due_date,
  electricity_roll_forward_to_bill_id
)
VALUES (
  'd1000000-0000-4000-8000-000000000064',
  'd1000000-0000-4000-8000-000000000040',
  current_date - 80,
  current_date - 41,
  current_date - 40,
  'd1000000-0000-4000-8000-000000000060'
);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $carry_target$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1090,
      'correction-request-carry-target'
    );
    RAISE EXCEPTION 'Carry-forward target unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK004' THEN
    IF SQLERRM <> 'This reading is part of a carry-forward and cannot be changed.' THEN
      RAISE;
    END IF;
  END;
END;
$carry_target$;
RESET ROLE;
DELETE FROM public.monthly_bill
WHERE bill_id = 'd1000000-0000-4000-8000-000000000064';

-- Finalized bills and paid-but-not-finalized bills are separate blocked states.
SELECT set_config(
  'inkeeper.explicit_finalize_bill_id',
  'd1000000-0000-4000-8000-000000000060',
  true
);
UPDATE public.monthly_bill
SET billed_at = now()
WHERE bill_id = 'd1000000-0000-4000-8000-000000000060';
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $finalized$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1090,
      'correction-request-finalized'
    );
    RAISE EXCEPTION 'Finalized bill unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK001' THEN
    IF SQLERRM <> 'This bill is finalized and can no longer be changed.' THEN
      RAISE;
    END IF;
  END;
END;
$finalized$;
RESET ROLE;
UPDATE public.monthly_bill
SET billed_at = NULL
WHERE bill_id = 'd1000000-0000-4000-8000-000000000060';

UPDATE public.monthly_bill
SET paid_at = now()
WHERE bill_id = 'd1000000-0000-4000-8000-000000000060';
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $paid$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1090,
      'correction-request-paid'
    );
    RAISE EXCEPTION 'Paid bill unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK002' THEN
    IF SQLERRM <> 'This bill is paid, so the reading cannot be changed.' THEN
      RAISE;
    END IF;
  END;
END;
$paid$;
RESET ROLE;
UPDATE public.monthly_bill
SET paid_at = NULL
WHERE bill_id = 'd1000000-0000-4000-8000-000000000060';

-- Move-in and initial readings are blocked even if legacy data links them to a bill.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $move_in$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000062',
      520,
      'correction-request-movein'
    );
    RAISE EXCEPTION 'Move-in reading unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK005' THEN
    IF SQLERRM <> 'The tenant''s move-in reading cannot be changed.' THEN
      RAISE;
    END IF;
  END;
END;
$move_in$;
DO $initial$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000063',
      610,
      'correction-request-initial'
    );
    RAISE EXCEPTION 'Initial reading unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK006' THEN
    IF SQLERRM <> 'The initial meter reading cannot be changed.' THEN
      RAISE;
    END IF;
  END;
END;
$initial$;
RESET ROLE;

-- Archived tenancy records are blocked while the room and bill still exist.
INSERT INTO public.tenant_archive (
  archive_id,
  owner_id,
  tenant_id,
  tenancy_id,
  tenant_name,
  move_in_date,
  move_out_date,
  room_name,
  boarding_house_name
)
VALUES (
  'd1000000-0000-4000-8000-000000000080',
  'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000030',
  'd1000000-0000-4000-8000-000000000040',
  'Maria Santos',
  current_date - 40,
  current_date,
  'Room 3',
  'Correction house'
);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $archived$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1090,
      'correction-request-archived'
    );
    RAISE EXCEPTION 'Archived tenant correction unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'IK007' THEN
    IF SQLERRM <> 'Only an active tenant''s bill reading can be corrected.' THEN
      RAISE;
    END IF;
  END;
END;
$archived$;
RESET ROLE;
DELETE FROM public.tenant_archive
WHERE archive_id = 'd1000000-0000-4000-8000-000000000080';

-- A failure while writing the audit row rolls back the reading and item update.
CREATE FUNCTION pg_temp.fail_correction_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Forced audit failure';
END;
$function$;
CREATE TRIGGER fail_correction_audit
BEFORE INSERT ON public.bill_meter_reading_corrections
FOR EACH ROW
EXECUTE FUNCTION pg_temp.fail_correction_audit();

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
DO $failure$
BEGIN
  BEGIN
    PERFORM public.correct_bill_meter_reading(
      'd1000000-0000-4000-8000-000000000060',
      1090,
      'correction-request-rollback'
    );
    RAISE EXCEPTION 'Forced audit failure did not occur';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Forced audit failure' THEN
      RAISE;
    END IF;
  END;
END;
$failure$;
RESET ROLE;

DROP TRIGGER fail_correction_audit
  ON public.bill_meter_reading_corrections;

DO $rollback_assert$
BEGIN
  IF (
    SELECT reading_value
    FROM public.meter_readings
    WHERE reading_id = 'd1000000-0000-4000-8000-000000000051'
  ) <> 1080 THEN
    RAISE EXCEPTION 'Failure did not roll back the reading';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.bill_items
    WHERE bill_item_id = 'd1000000-0000-4000-8000-000000000073'
      AND quantity = 80
      AND amount = 800
      AND unit_price = 10
  ) THEN
    RAISE EXCEPTION 'Failure did not roll back the electricity item';
  END IF;
  IF (
    SELECT total_amount
    FROM public.monthly_bill
    WHERE bill_id = 'd1000000-0000-4000-8000-000000000060'
  ) <> 3900 THEN
    RAISE EXCEPTION 'Failure did not roll back the bill total';
  END IF;
  IF (
    SELECT count(*)
    FROM public.bill_meter_reading_corrections
    WHERE request_id = 'correction-request-rollback'
  ) <> 0 THEN
    RAISE EXCEPTION 'Failed correction left an audit row';
  END IF;
END;
$rollback_assert$;

ROLLBACK;
