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

  IF v_job_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one send-bill-reminders cron job, found %',
      v_job_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'bill_reminders_cron_token'
      AND decrypted_secret <> ''
  ) THEN
    RAISE EXCEPTION 'Vault secret bill_reminders_cron_token is required';
  END IF;

  PERFORM cron.alter_job(
    v_job_id,
    command := $command$
      SELECT net.http_post(
        url := 'https://zsnwidizzfgakbvtarvn.functions.supabase.co/send-bill-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-bill-reminders-cron-token',
          (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'bill_reminders_cron_token'
          )
        ),
        body := '{}'::jsonb
      );
    $command$
  );
END;
$$;