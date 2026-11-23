-- Run only against an isolated test database after applying the migration.
BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('e9980000-0000-4000-8000-000000000001', 'overlap-owner@example.invalid');

INSERT INTO public.boarding_house (boarding_house_id, owner_id, name, address)
VALUES (
  'e9980000-0000-4000-8000-000000000010',
  'e9980000-0000-4000-8000-000000000001',
  'Overlap test house',
  'Test address'
);

INSERT INTO public.rooms (room_id, boarding_house_id, room_name, monthly_rate)
VALUES (
  'e9980000-0000-4000-8000-000000000020',
  'e9980000-0000-4000-8000-000000000010',
  'Room A',
  100
);

INSERT INTO public.tenants (tenant_id, owner_id, name)
VALUES (
  'e9980000-0000-4000-8000-000000000030',
  'e9980000-0000-4000-8000-000000000001',
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
  'e9980000-0000-4000-8000-000000000040',
  'e9980000-0000-4000-8000-000000000001',
  'e9980000-0000-4000-8000-000000000030',
  'e9980000-0000-4000-8000-000000000020',
  current_date - 30,
  current_date
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'e9980000-0000-4000-8000-000000000001',
  true
);

DO $test$
BEGIN
  BEGIN
    PERFORM public.register_tenancy_with_opening_reading(
      'e9980000-0000-4000-8000-000000000020',
      'New Tenant',
      '09170000000',
      'new-tenant@example.invalid',
      'e9980000-0000-4000-8000-000000000001/e9980000-0000-4000-8000-000000000020/registration-1/id/document.jpg',
      'e9980000-0000-4000-8000-000000000001/e9980000-0000-4000-8000-000000000020/registration-1/agreement/document.jpg',
      current_date - 1,
      '[]'::jsonb,
      50
    );
    RAISE EXCEPTION 'Overlapping tenancy unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'The move-in date must be on or after %' THEN
      RAISE;
    END IF;
  END;
END;
$test$;

ROLLBACK;
