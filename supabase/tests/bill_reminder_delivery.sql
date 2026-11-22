BEGIN;

CREATE TEMP TABLE reminder_uniqueness_probe (
  bill_id uuid NOT NULL,
  reminder_type public.reminder_type NOT NULL,
  reminder_day date
);

CREATE UNIQUE INDEX reminder_uniqueness_probe_key
  ON reminder_uniqueness_probe (bill_id, reminder_type, reminder_day)
  NULLS NOT DISTINCT;

DO $$
DECLARE
  v_bill_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO reminder_uniqueness_probe
  VALUES (
    v_bill_id,
    'owner_reading_due'::public.reminder_type,
    DATE '2026-11-21'
  );

  BEGIN
    INSERT INTO reminder_uniqueness_probe
    VALUES (
      v_bill_id,
      'owner_reading_due'::public.reminder_type,
      DATE '2026-11-21'
    );
    RAISE EXCEPTION 'Same-day owner duplicate was allowed';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  INSERT INTO reminder_uniqueness_probe
  VALUES (
    v_bill_id,
    'owner_reading_due'::public.reminder_type,
    DATE '2026-11-22'
  );

  INSERT INTO reminder_uniqueness_probe
  VALUES (
    v_bill_id,
    'tenant_bill_sent'::public.reminder_type,
    NULL
  );

  BEGIN
    INSERT INTO reminder_uniqueness_probe
    VALUES (
      v_bill_id,
      'tenant_bill_sent'::public.reminder_type,
      NULL
    );
    RAISE EXCEPTION 'Duplicate tenant bill delivery was allowed';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  INSERT INTO reminder_uniqueness_probe
  VALUES (
    v_bill_id,
    'owner_reading_due'::public.reminder_type,
    DATE '1900-01-01'
  );
  INSERT INTO reminder_uniqueness_probe
  VALUES (
    v_bill_id,
    'owner_reading_due'::public.reminder_type,
    DATE '2026-11-23'
  );
END;
$$;

ROLLBACK;
