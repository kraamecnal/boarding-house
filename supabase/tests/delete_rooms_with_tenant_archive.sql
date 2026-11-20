-- Run only against an isolated test database after applying the migration.
BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('e8880000-0000-4000-8000-000000000001', 'room-delete-owner@example.invalid'),
  ('e8880000-0000-4000-8000-000000000002', 'room-delete-other@example.invalid');

INSERT INTO public.boarding_house (boarding_house_id, owner_id, name, address)
VALUES
  ('e8880000-0000-4000-8000-000000000010', 'e8880000-0000-4000-8000-000000000001', 'Test house', 'Test address'),
  ('e8880000-0000-4000-8000-000000000011', 'e8880000-0000-4000-8000-000000000002', 'Other house', 'Other address');
INSERT INTO public.rooms (room_id, boarding_house_id, room_name, monthly_rate)
VALUES
  ('e8880000-0000-4000-8000-000000000020', 'e8880000-0000-4000-8000-000000000010', 'Room A', 100),
  ('e8880000-0000-4000-8000-000000000021', 'e8880000-0000-4000-8000-000000000010', 'Room B', 100),
  ('e8880000-0000-4000-8000-000000000022', 'e8880000-0000-4000-8000-000000000011', 'Other room', 100);
INSERT INTO public.tenants (tenant_id, owner_id, name, id_photo_url)
VALUES
  ('e8880000-0000-4000-8000-000000000030', 'e8880000-0000-4000-8000-000000000001', 'Active tenant', 'test-id'),
  ('e8880000-0000-4000-8000-000000000031', 'e8880000-0000-4000-8000-000000000001', 'Scheduled tenant', NULL),
  ('e8880000-0000-4000-8000-000000000032', 'e8880000-0000-4000-8000-000000000001', 'Past tenant', NULL);
INSERT INTO public.tenancy (tenancy_id, owner_id, tenant_id, room_id, move_in_date, move_out_date, agreement_photo_url)
VALUES
  ('e8880000-0000-4000-8000-000000000040', 'e8880000-0000-4000-8000-000000000001', 'e8880000-0000-4000-8000-000000000030', 'e8880000-0000-4000-8000-000000000020', current_date - 30, NULL, 'test-agreement'),
  ('e8880000-0000-4000-8000-000000000041', 'e8880000-0000-4000-8000-000000000001', 'e8880000-0000-4000-8000-000000000031', 'e8880000-0000-4000-8000-000000000021', current_date + 30, NULL, NULL),
  ('e8880000-0000-4000-8000-000000000042', 'e8880000-0000-4000-8000-000000000001', 'e8880000-0000-4000-8000-000000000032', 'e8880000-0000-4000-8000-000000000020', current_date - 90, current_date - 60, NULL);
INSERT INTO public.meter_readings (reading_id, room_id, reading_value, reading_at)
VALUES ('e8880000-0000-4000-8000-000000000050', 'e8880000-0000-4000-8000-000000000020', 10, current_date);
INSERT INTO public.room_default_charges (rooom_id, item_type, unit_price)
VALUES ('e8880000-0000-4000-8000-000000000020', 'water', 10);
INSERT INTO public.monthly_bill (bill_id, tenancy_id, period_start, period_end, due_date)
VALUES ('e8880000-0000-4000-8000-000000000060', 'e8880000-0000-4000-8000-000000000040', current_date - 30, current_date, current_date + 10);
INSERT INTO public.bill_items (bill_item_id, bill_id, item_type, unit_price)
VALUES ('e8880000-0000-4000-8000-000000000061', 'e8880000-0000-4000-8000-000000000060', 'rent', 100);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e8880000-0000-4000-8000-000000000001', true);

DO $test$
BEGIN
  BEGIN
    PERFORM public.delete_rooms_with_tenant_archive(
      'e8880000-0000-4000-8000-000000000010',
      ARRAY['e8880000-0000-4000-8000-000000000020'::uuid, 'e8880000-0000-4000-8000-000000000022'::uuid]
    );
    RAISE EXCEPTION 'Unauthorized batch unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'One or more rooms were not found or are not authorized' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE room_id = 'e8880000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'Rejected batch changed a room';
  END IF;

  BEGIN
    PERFORM public.delete_rooms_with_tenant_archive(
      'e8880000-0000-4000-8000-000000000010',
      ARRAY['e8880000-0000-4000-8000-000000000020'::uuid]
    );
    RAISE EXCEPTION 'Force rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Force rollback' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE room_id = 'e8880000-0000-4000-8000-000000000020')
     OR NOT EXISTS (SELECT 1 FROM public.tenancy WHERE tenancy_id = 'e8880000-0000-4000-8000-000000000040' AND status = 'active')
     OR EXISTS (SELECT 1 FROM public.tenant_archive WHERE tenancy_id = 'e8880000-0000-4000-8000-000000000040') THEN
    RAISE EXCEPTION 'Rollback did not restore room and tenancy';
  END IF;

  IF public.delete_rooms_with_tenant_archive(
    'e8880000-0000-4000-8000-000000000010',
    ARRAY['e8880000-0000-4000-8000-000000000020'::uuid, 'e8880000-0000-4000-8000-000000000021'::uuid]
  ) <> 2 THEN
    RAISE EXCEPTION 'Incorrect room deletion count';
  END IF;

  IF (SELECT count(*) FROM public.tenant_archive WHERE tenancy_id IN (
    'e8880000-0000-4000-8000-000000000040', 'e8880000-0000-4000-8000-000000000041',
    'e8880000-0000-4000-8000-000000000042'
  )) <> 3 THEN RAISE EXCEPTION 'Missing archived tenancy'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_archive
    WHERE tenancy_id = 'e8880000-0000-4000-8000-000000000040'
      AND room_name = 'Room A' AND boarding_house_name = 'Test house'
      AND boarding_house_address = 'Test address'
      AND id_photo_path = 'test-id' AND agreement_photo_path = 'test-agreement'
  ) THEN RAISE EXCEPTION 'Incomplete archive snapshot'; END IF;
  IF (SELECT count(*) FROM public.tenancy WHERE tenancy_id IN (
    'e8880000-0000-4000-8000-000000000040', 'e8880000-0000-4000-8000-000000000041',
    'e8880000-0000-4000-8000-000000000042'
  ) AND status = 'ended' AND room_id IS NULL) <> 3 THEN
    RAISE EXCEPTION 'Tenancies not ended and detached';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bill_items WHERE bill_item_id = 'e8880000-0000-4000-8000-000000000061') THEN
    RAISE EXCEPTION 'Archived bill item is not visible to its owner';
  END IF;
END;
$test$;

SELECT set_config('request.jwt.claim.sub', 'e8880000-0000-4000-8000-000000000002', true);
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bill_items WHERE bill_item_id = 'e8880000-0000-4000-8000-000000000061') THEN
    RAISE EXCEPTION 'Another owner can see archived bill items';
  END IF;
END;
$test$;

RESET ROLE;
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.rooms WHERE room_id IN (
    'e8880000-0000-4000-8000-000000000020', 'e8880000-0000-4000-8000-000000000021'
  )) OR EXISTS (SELECT 1 FROM public.room_default_charges WHERE rooom_id = 'e8880000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'Rooms or room charges remain';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meter_readings WHERE reading_id = 'e8880000-0000-4000-8000-000000000050' AND room_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.boarding_house WHERE boarding_house_id = 'e8880000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'Meter reading or boarding house not preserved';
  END IF;
END;
$test$;
ROLLBACK;
