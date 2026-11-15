DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type existing_type
    JOIN pg_namespace existing_schema ON existing_schema.oid = existing_type.typnamespace
    WHERE existing_schema.nspname = 'public'
      AND existing_type.typname = 'reminder_type'
  ) THEN
    CREATE TYPE public.reminder_type AS ENUM ('two_days_before', 'on_due_date');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.bill_reminders (
  reminder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.monthly_bill(bill_id) ON DELETE CASCADE,
  reminder_type public.reminder_type NOT NULL,
  delivery_status text NOT NULL DEFAULT 'sending',
  attempt_count integer NOT NULL DEFAULT 0,
  attempt_started_at timestamptz,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text
);

ALTER TABLE public.bill_reminders
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS attempt_count integer,
  ADD COLUMN IF NOT EXISTS attempt_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

UPDATE public.bill_reminders
SET delivery_status = 'sent'
WHERE delivery_status IS NULL;

UPDATE public.bill_reminders
SET attempt_count = 0
WHERE attempt_count IS NULL;

ALTER TABLE public.bill_reminders
  ALTER COLUMN delivery_status SET DEFAULT 'sending',
  ALTER COLUMN delivery_status SET NOT NULL,
  ALTER COLUMN attempt_count SET DEFAULT 0,
  ALTER COLUMN attempt_count SET NOT NULL,
  ALTER COLUMN sent_at DROP DEFAULT,
  ALTER COLUMN sent_at DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bill_reminders_bill_id_reminder_type_key
  ON public.bill_reminders (bill_id, reminder_type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_reminders'::regclass
      AND conname = 'bill_reminders_delivery_status_check'
  ) THEN
    ALTER TABLE public.bill_reminders
      ADD CONSTRAINT bill_reminders_delivery_status_check
      CHECK (delivery_status IN ('sending', 'sent', 'failed', 'uncertain'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_reminders'::regclass
      AND conname = 'bill_reminders_attempt_count_check'
  ) THEN
    ALTER TABLE public.bill_reminders
      ADD CONSTRAINT bill_reminders_attempt_count_check
      CHECK (attempt_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bill_reminders'::regclass
      AND conname = 'bill_reminders_sent_state_check'
  ) THEN
    ALTER TABLE public.bill_reminders
      ADD CONSTRAINT bill_reminders_sent_state_check
      CHECK (
        (delivery_status = 'sent' AND sent_at IS NOT NULL)
        OR (delivery_status <> 'sent' AND sent_at IS NULL)
      );
  END IF;
END;
$$;

ALTER TABLE public.bill_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bill_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bill_reminders TO authenticated;
GRANT ALL ON TABLE public.bill_reminders TO service_role;

DROP POLICY IF EXISTS "owners view own bill reminders" ON public.bill_reminders;
CREATE POLICY "owners view own bill reminders"
  ON public.bill_reminders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.monthly_bill bill
      JOIN public.tenancy tenancy ON tenancy.tenancy_id = bill.tenancy_id
      WHERE bill.bill_id = bill_reminders.bill_id
        AND tenancy.owner_id = (SELECT auth.uid())
    )
  );

DO $$
DECLARE
  v_job_id bigint;
  v_job_count integer;
BEGIN
  SELECT count(*), min(jobid)
  INTO v_job_count, v_job_id
  FROM cron.job
  WHERE jobname = 'send-bill-reminders-daily'
    AND command LIKE '%/send-bill-reminders%';

  IF v_job_count > 1 THEN
    RAISE EXCEPTION 'Multiple send-bill-reminders cron jobs found; resolve duplicates before applying this migration';
  ELSIF v_job_count = 1 THEN
    PERFORM cron.alter_job(v_job_id, schedule := '0 * * * *');
  ELSE
    RAISE NOTICE 'send-bill-reminders-daily was not found; configure the existing scheduled invocation separately';
  END IF;
END;
$$;