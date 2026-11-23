-- Run only against an isolated test database after applying the migration.
BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('e9990000-0000-4000-8000-000000000001', 'meter-handoff-owner@example.invalid');

INSERT INTO public.boarding_house (boarding_house_id, owner_id, name, address)
VALUES (
  'e9990000-0000-4000-8000-000000000010',
  'e9990000-0000-4000-8000-000000000001',
  'Meter handoff house',
  'Test address'
);

INSERT INTO public.rooms (room_id, boarding_house_id, room_name, monthly_rate)
VALUES (
  'e9990000-0000-4000-8000-000000000020',
  'e9990000-0000-4000-8000-000000000010',
  'Room A',
  100
);

INSERT INTO public.tenants (tenant_id, owner_id, name)
VALUES (
  'e9990000-0000-4000-8000-000000000030',
  'e9990000-0000-4000-8000-000000000001',
  'Previous tenant'
);

INSERT INTO public.tenancy (
  tenancy_id,
  owner_id,
  tenant_id,
  room_id,
  move_in_date,
  move_out_date
)
VALUES (
  'e9990000-0000-4000-8000-000000000040',
  'e9990000-0000-4000-8000-000000000001',
  'e9990000-0000-4000-8000-000000000030',
  'e9990000-0000-4000-8000-000000000020',
  current_date - 30,
  current_date
);

INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
VALUES (
  'e9990000-0000-4000-8000-000000000020',
  50,
  current_date
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'e9990000-0000-4000-8000-000000000001',
  true
);

DO $test$
DECLARE
  v_tenancy_id uuid;
BEGIN
  v_tenancy_id := public.register_tenancy_with_opening_reading(
    'e9990000-0000-4000-8000-000000000020',
    'New Tenant',
    '09170000000',
    'new-tenant@example.invalid',
    'e9990000-0000-4000-8000-000000000001/e9990000-0000-4000-8000-000000000020/registration-1/id/document.jpg',
    'e9990000-0000-4000-8000-000000000001/e9990000-0000-4000-8000-000000000020/registration-1/agreement/document.jpg',
    current_date,
    '[]'::jsonb,
    NULL
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.tenancy
    WHERE tenancy_id = v_tenancy_id
      AND room_id = 'e9990000-0000-4000-8000-000000000020'
      AND move_in_date = current_date
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Tenant was not registered with the existing move-in reading';
  END IF;

  IF (
    SELECT count(*)
    FROM public.meter_readings
    WHERE room_id = 'e9990000-0000-4000-8000-000000000020'
      AND reading_at = current_date
  ) <> 1 THEN
    RAISE EXCEPTION 'Existing move-in reading was duplicated';
  END IF;
END;
$test$;

ROLLBACK;
