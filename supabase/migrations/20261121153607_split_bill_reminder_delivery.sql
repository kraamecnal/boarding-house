BEGIN;

CREATE TABLE private.bill_reminders_backup_20261121
AS
SELECT
  reminder_id,
  bill_id,
  reminder_type::text AS reminder_type,
  sent_at,
  delivery_status,
  attempt_count,
  attempt_started_at,
  next_attempt_at,
  last_error
FROM public.bill_reminders;

ALTER TABLE public.bill_reminders
  DROP CONSTRAINT IF EXISTS bill_reminders_bill_id_reminder_type_key,
  DROP CONSTRAINT IF EXISTS bill_reminders_delivery_status_check,
  DROP CONSTRAINT IF EXISTS bill_reminders_attempt_count_check,
  DROP CONSTRAINT IF EXISTS bill_reminders_sent_state_check,
  DROP CONSTRAINT IF EXISTS bill_reminders_reminder_day_check,
  ALTER COLUMN sent_at DROP NOT NULL;

ALTER TYPE public.reminder_type RENAME TO reminder_type_legacy;
CREATE TYPE public.reminder_type AS ENUM (
  'owner_reading_due_soon',
  'owner_reading_due',
  'tenant_bill_sent'
);

ALTER TABLE public.bill_reminders
  ALTER COLUMN reminder_type TYPE public.reminder_type
  USING (
    CASE reminder_type::text
      WHEN 'two_days_before' THEN 'owner_reading_due_soon'::public.reminder_type
      WHEN 'on_due_date' THEN 'owner_reading_due'::public.reminder_type
    END
  );

DROP TYPE public.reminder_type_legacy;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bill_reminders'
      AND column_name = 'next_attempt_at'
  ) THEN
    ALTER TABLE public.bill_reminders
      RENAME COLUMN next_attempt_at TO retry_at;
  END IF;
END;
$$;

ALTER TABLE public.bill_reminders
  ADD COLUMN IF NOT EXISTS reminder_day date,
  ADD COLUMN IF NOT EXISTS message_id text,
  ADD COLUMN IF NOT EXISTS client_request_id text,
  ADD COLUMN IF NOT EXISTS retry_at timestamptz;

UPDATE public.bill_reminders
SET
  delivery_status = CASE
    WHEN delivery_status = 'sending' THEN 'pending'
    WHEN delivery_status IN ('pending', 'sent', 'failed', 'uncertain') THEN delivery_status
    ELSE 'failed'
  END,
  attempt_count = coalesce(attempt_count, 0),
  reminder_day = DATE '1900-01-01',
  sent_at = CASE
    WHEN delivery_status = 'sent'
      THEN coalesce(sent_at, attempt_started_at, now())
    ELSE NULL
  END;

ALTER TABLE public.bill_reminders
  ALTER COLUMN delivery_status SET DEFAULT 'pending',
  ALTER COLUMN delivery_status SET NOT NULL,
  ALTER COLUMN attempt_count SET DEFAULT 0,
  ALTER COLUMN attempt_count SET NOT NULL,
  ADD CONSTRAINT bill_reminders_delivery_status_check
    CHECK (delivery_status IN ('pending', 'sent', 'failed', 'uncertain')),
  ADD CONSTRAINT bill_reminders_attempt_count_check
    CHECK (attempt_count >= 0),
  ADD CONSTRAINT bill_reminders_sent_state_check
    CHECK (
      (delivery_status = 'sent' AND sent_at IS NOT NULL)
      OR (delivery_status <> 'sent' AND sent_at IS NULL)
    ),
  ADD CONSTRAINT bill_reminders_reminder_day_check
    CHECK (
      (
        reminder_type = 'tenant_bill_sent'::public.reminder_type
        AND reminder_day IS NULL
      )
      OR
      (
        reminder_type <> 'tenant_bill_sent'::public.reminder_type
        AND reminder_day IS NOT NULL
      )
    ),
  ADD CONSTRAINT bill_reminders_message_id_check
    CHECK (message_id IS NULL OR length(message_id) <= 500),
  ADD CONSTRAINT bill_reminders_client_request_id_check
    CHECK (client_request_id IS NULL OR length(client_request_id) <= 100);

ALTER TABLE public.bill_reminders
  ADD CONSTRAINT bill_reminders_bill_type_day_key
  UNIQUE NULLS NOT DISTINCT (bill_id, reminder_type, reminder_day);

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

CREATE OR REPLACE FUNCTION public.enforce_explicit_bill_finalization()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_explicit_bill_id text;
BEGIN
  IF old.billed_at IS NULL AND new.billed_at IS NOT NULL THEN
    v_explicit_bill_id := current_setting(
      'inkeeper.explicit_finalize_bill_id',
      true
    );
    IF v_explicit_bill_id IS DISTINCT FROM new.bill_id::text THEN
      new.billed_at := old.billed_at;
    END IF;
  END IF;

  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS aaa_enforce_explicit_bill_finalization
  ON public.monthly_bill;
DROP TRIGGER IF EXISTS zzz_enforce_explicit_bill_finalization
  ON public.monthly_bill;
-- Runs after the existing guard trigger, so it can undo any automatic finalization.
CREATE TRIGGER zzz_enforce_explicit_bill_finalization
  BEFORE UPDATE OF billed_at, electricity_roll_forward_to_bill_id
  ON public.monthly_bill
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_explicit_bill_finalization();

REVOKE ALL ON FUNCTION public.enforce_explicit_bill_finalization()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_explicit_bill_finalization()
  TO service_role;

CREATE OR REPLACE FUNCTION private.build_bill_email_payload(p_bill_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'billId', bill.bill_id,
    'tenantName', tenant.name,
    'tenantEmail', nullif(btrim(tenant.email_address), ''),
    'roomName', room.room_name,
    'periodStart', bill.period_start,
    'periodEnd', bill.period_end,
    'dueDate', bill.due_date,
    'billedAt', bill.billed_at,
    'totalAmount', bill.total_amount,
    'electricityCarriedForward',
      bill.electricity_roll_forward_to_bill_id IS NOT NULL,
    'items', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'itemType', item.item_type,
            'description', item.description,
            'quantity', item.quantity,
            'unitPrice', item.unit_price,
            'amount', item.amount
          )
          ORDER BY
            CASE item.item_type
              WHEN 'rent' THEN 1
              WHEN 'water' THEN 2
              WHEN 'trash' THEN 3
              WHEN 'wifi' THEN 4
              WHEN 'electricity' THEN 5
              WHEN 'adjustment' THEN 6
            END,
            item.description NULLS FIRST,
            item.bill_item_id
        )
        FROM public.bill_items item
        WHERE item.bill_id = bill.bill_id
      ),
      '[]'::jsonb
    )
  )
  FROM public.monthly_bill bill
  JOIN public.tenancy tenancy ON tenancy.tenancy_id = bill.tenancy_id
  JOIN public.tenants tenant ON tenant.tenant_id = tenancy.tenant_id
  JOIN public.rooms room ON room.room_id = tenancy.room_id
  WHERE bill.bill_id = p_bill_id;
$function$;

REVOKE ALL ON FUNCTION private.build_bill_email_payload(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.build_bill_email_payload(uuid)
  TO service_role;

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
          AND item.description = 'Electricity'
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

CREATE OR REPLACE FUNCTION public.claim_tenant_bill_resend(
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
  v_reminder public.bill_reminders%ROWTYPE;
  v_reminder_created boolean := false;
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
  IF v_bill.billed_at IS NULL THEN
    RAISE EXCEPTION 'Finalize this bill before resending it';
  END IF;

  SELECT *
  INTO v_reminder
  FROM public.bill_reminders
  WHERE bill_id = v_bill.bill_id
    AND reminder_type = 'tenant_bill_sent'::public.reminder_type
    AND reminder_day IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
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
    RETURNING * INTO v_reminder;
    v_reminder_created := true;
  END IF;

  IF NOT v_reminder_created THEN
    IF v_reminder.client_request_id = p_request_id THEN
      RAISE EXCEPTION 'This resend request was already processed or is still pending';
    END IF;
    IF v_reminder.delivery_status = 'pending'
       AND coalesce(v_reminder.attempt_started_at, '-infinity'::timestamptz)
           > now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'A bill email delivery is already in progress';
    END IF;

    UPDATE public.bill_reminders
    SET
      delivery_status = 'pending',
      attempt_count = attempt_count + 1,
      attempt_started_at = now(),
      retry_at = NULL,
      sent_at = NULL,
      message_id = NULL,
      last_error = NULL,
      client_request_id = p_request_id
    WHERE reminder_id = v_reminder.reminder_id;

    v_reminder.attempt_count := v_reminder.attempt_count + 1;
  END IF;

  v_payload := private.build_bill_email_payload(v_bill.bill_id);
  IF v_payload ->> 'tenantEmail' IS NULL THEN
    UPDATE public.bill_reminders
    SET
      delivery_status = 'failed',
      attempt_started_at = now(),
      last_error = 'No email on file for this tenant.'
    WHERE reminder_id = v_reminder.reminder_id;

    RETURN jsonb_build_object(
      'kind', 'no_email',
      'reminderId', v_reminder.reminder_id,
      'attemptCount', v_reminder.attempt_count,
      'bill', v_payload
    );
  END IF;

  RETURN jsonb_build_object(
    'kind', 'pending',
    'reminderId', v_reminder.reminder_id,
    'attemptCount', v_reminder.attempt_count,
    'bill', v_payload
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_tenant_bill_resend(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_tenant_bill_resend(uuid, text)
  TO authenticated, service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'send-bill-reminders-daily';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected send-bill-reminders-daily cron job to exist';
  END IF;

  PERFORM cron.alter_job(
    v_job_id,
    schedule := '0 0 * * *'
  );

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'create-notification-due-reminders-daily';
END;
$$;

COMMIT;