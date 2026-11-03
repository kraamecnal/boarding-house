CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 200),
  type text NOT NULL CHECK (type IN (
    'bill_generated',
    'bill_due_soon',
    'bill_due_today',
    'bill_paid',
    'tenant_registered',
    'tenant_moved_in',
    'tenancy_ended',
    'meter_reading_required',
    'electricity_charge_added'
  )),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  message text NOT NULL CHECK (length(btrim(message)) > 0),
  related_bill_id uuid REFERENCES public.monthly_bill(bill_id) ON DELETE SET NULL,
  related_tenancy_id uuid REFERENCES public.tenancy(tenancy_id) ON DELETE SET NULL,
  related_room_id uuid REFERENCES public.rooms(room_id) ON DELETE SET NULL,
  related_record_id uuid GENERATED ALWAYS AS (
    coalesce(related_bill_id, related_tenancy_id, related_room_id)
  ) STORED,
  related_record_type text GENERATED ALWAYS AS (
    CASE
      WHEN related_bill_id IS NOT NULL THEN 'monthly_bill'
      WHEN related_tenancy_id IS NOT NULL THEN 'tenancy'
      WHEN related_room_id IS NOT NULL THEN 'room'
    END
  ) STORED,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT notifications_owner_event_key_key UNIQUE (owner_id, event_key),
  CONSTRAINT notifications_single_related_record_check CHECK (
    num_nonnulls(related_bill_id, related_tenancy_id, related_room_id) <= 1
  ),
  CONSTRAINT notifications_read_state_check CHECK (
    (is_read AND read_at IS NOT NULL) OR (NOT is_read AND read_at IS NULL)
  )
);

CREATE INDEX notifications_owner_created_at_idx
  ON public.notifications (owner_id, created_at DESC);
CREATE INDEX notifications_owner_unread_created_at_idx
  ON public.notifications (owner_id, created_at DESC)
  WHERE NOT is_read;
CREATE INDEX notifications_related_bill_id_idx
  ON public.notifications (related_bill_id)
  WHERE related_bill_id IS NOT NULL;
CREATE INDEX notifications_related_tenancy_id_idx
  ON public.notifications (related_tenancy_id)
  WHERE related_tenancy_id IS NOT NULL;
CREATE INDEX notifications_related_room_id_idx
  ON public.notifications (related_room_id)
  WHERE related_room_id IS NOT NULL;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon;
GRANT SELECT, UPDATE (is_read, read_at) ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;

CREATE POLICY "Owners view their notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "Owners mark their notifications as read"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      (is_read AND read_at IS NOT NULL)
      OR (NOT is_read AND read_at IS NULL)
    )
  );

CREATE TABLE public.device_push_tokens (
  expo_push_token text PRIMARY KEY CHECK (length(expo_push_token) BETWEEN 1 AND 255),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_push_tokens_owner_id_idx
  ON public.device_push_tokens (owner_id);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.device_push_tokens FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.device_push_tokens TO authenticated;
GRANT ALL ON TABLE public.device_push_tokens TO service_role;

CREATE POLICY "Owners manage their push tokens"
  ON public.device_push_tokens
  FOR ALL
  TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION private.enqueue_notification(
  p_owner_id uuid,
  p_event_key text,
  p_type text,
  p_title text,
  p_message text,
  p_related_record_type text,
  p_related_record_id uuid,
  p_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (p_related_record_type IS NULL) <> (p_related_record_id IS NULL)
     OR (p_related_record_type IS NOT NULL
         AND p_related_record_type NOT IN ('monthly_bill', 'tenancy', 'room')) THEN
    RAISE EXCEPTION 'A supported related record type and ID must be provided together';
  END IF;

  INSERT INTO public.notifications (
    owner_id,
    event_key,
    type,
    title,
    message,
    related_bill_id,
    related_tenancy_id,
    related_room_id,
    data
  )
  VALUES (
    p_owner_id,
    p_event_key,
    p_type,
    p_title,
    p_message,
    CASE WHEN p_related_record_type = 'monthly_bill' THEN p_related_record_id END,
    CASE WHEN p_related_record_type = 'tenancy' THEN p_related_record_id END,
    CASE WHEN p_related_record_type = 'room' THEN p_related_record_id END,
    coalesce(p_data, '{}'::jsonb)
  )
  ON CONFLICT (owner_id, event_key) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION private.notify_monthly_bill_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid;
  v_room_id uuid;
  v_room_name text;
  v_boarding_house_id uuid;
  v_period text;
  v_route_data jsonb;
BEGIN
  v_period := to_char(NEW.period_start, 'YYYY-MM');

  SELECT t.owner_id, t.room_id, r.room_name, r.boarding_house_id
  INTO v_owner_id, v_room_id, v_room_name, v_boarding_house_id
  FROM public.tenancy t
  JOIN public.rooms r ON r.room_id = t.room_id
  WHERE t.tenancy_id = NEW.tenancy_id;

  IF v_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_route_data := jsonb_build_object(
    'room_id', v_room_id,
    'boarding_house_id', v_boarding_house_id,
    'period', v_period
  );

  IF TG_OP = 'INSERT' THEN
    PERFORM private.enqueue_notification(
      v_owner_id,
      'bill-generated:' || NEW.bill_id::text,
      'bill_generated',
      'New monthly bill',
      format('A bill for %s has been generated and is due %s.', v_room_name, NEW.due_date),
      'monthly_bill',
      NEW.bill_id,
      v_route_data
    );

    IF coalesce(NEW.paid_at, NULL) IS NULL
       AND EXISTS (
         SELECT 1
         FROM public.tenancy_default_charges tc
         WHERE tc.tenancy_id = NEW.tenancy_id
           AND tc.item_type = 'electricity'
         UNION ALL
         SELECT 1
         FROM public.owner_default_charges oc
         WHERE oc.owner_id = v_owner_id
           AND oc.item_type = 'electricity'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.bill_items bi
         WHERE bi.bill_id = NEW.bill_id
           AND bi.item_type = 'electricity'
       ) THEN
      PERFORM private.enqueue_notification(
        v_owner_id,
        'meter-reading-required:' || NEW.bill_id::text,
        'meter_reading_required',
        'Electricity reading needed',
        format('Add the electricity meter reading for %s to complete this bill.', v_room_name),
        'monthly_bill',
        NEW.bill_id,
        v_route_data
      );
    END IF;
  ELSIF OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL THEN
    PERFORM private.enqueue_notification(
      v_owner_id,
      'bill-paid:' || NEW.bill_id::text,
      'bill_paid',
      'Bill marked as paid',
      format('The bill for %s (%s) has been marked as paid.', v_room_name, v_period),
      'monthly_bill',
      NEW.bill_id,
      v_route_data
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER notifications_monthly_bill_events
  AFTER INSERT OR UPDATE ON public.monthly_bill
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_monthly_bill_changes();

CREATE OR REPLACE FUNCTION private.notify_tenancy_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tenant_name text;
  v_room_name text;
  v_boarding_house_id uuid;
  v_route_data jsonb;
BEGIN
  SELECT tenant.name, room.room_name, room.boarding_house_id
  INTO v_tenant_name, v_room_name, v_boarding_house_id
  FROM public.tenants tenant
  JOIN public.rooms room ON room.room_id = NEW.room_id
  WHERE tenant.tenant_id = NEW.tenant_id;

  IF v_tenant_name IS NULL THEN
    RETURN NEW;
  END IF;

  v_route_data := jsonb_build_object(
    'room_id', NEW.room_id,
    'boarding_house_id', v_boarding_house_id
  );

  IF TG_OP = 'INSERT' THEN
    PERFORM private.enqueue_notification(
      NEW.owner_id,
      'tenant-registered:' || NEW.tenancy_id::text,
      'tenant_registered',
      'New tenant registered',
      format('%s has been registered for %s.', v_tenant_name, v_room_name),
      'tenancy',
      NEW.tenancy_id,
      v_route_data
    );
    IF NEW.status = 'active' THEN
      PERFORM private.enqueue_notification(
        NEW.owner_id,
        'tenant-moved-in:' || NEW.tenancy_id::text,
        'tenant_moved_in',
        'Tenant moved in',
        format('%s has moved into %s.', v_tenant_name, v_room_name),
        'tenancy',
        NEW.tenancy_id,
        v_route_data
      );
    END IF;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'active' THEN
      PERFORM private.enqueue_notification(
        NEW.owner_id,
        'tenant-moved-in:' || NEW.tenancy_id::text,
        'tenant_moved_in',
        'Tenant moved in',
        format('%s has moved into %s.', v_tenant_name, v_room_name),
        'tenancy',
        NEW.tenancy_id,
        v_route_data
      );
    ELSIF NEW.status = 'ended' THEN
      PERFORM private.enqueue_notification(
        NEW.owner_id,
        'tenancy-ended:' || NEW.tenancy_id::text,
        'tenancy_ended',
        'Tenancy ended',
        format('%s''s tenancy in %s has ended.', v_tenant_name, v_room_name),
        'tenancy',
        NEW.tenancy_id,
        v_route_data
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER notifications_tenancy_events
  AFTER INSERT OR UPDATE ON public.tenancy
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_tenancy_changes();

CREATE OR REPLACE FUNCTION private.notify_electricity_charge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid;
  v_bill_id uuid;
  v_period_start date;
  v_room_id uuid;
  v_room_name text;
  v_boarding_house_id uuid;
  v_tenant_name text;
BEGIN
  IF NEW.item_type <> 'electricity' THEN
    RETURN NEW;
  END IF;

  SELECT bill.bill_id, bill.period_start, tenancy.owner_id, room.room_id,
         room.room_name, room.boarding_house_id, tenant.name
  INTO v_bill_id, v_period_start, v_owner_id, v_room_id, v_room_name,
       v_boarding_house_id, v_tenant_name
  FROM public.monthly_bill bill
  JOIN public.tenancy tenancy ON tenancy.tenancy_id = bill.tenancy_id
  JOIN public.rooms room ON room.room_id = tenancy.room_id
  JOIN public.tenants tenant ON tenant.tenant_id = tenancy.tenant_id
  WHERE bill.bill_id = NEW.bill_id;

  IF v_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM private.enqueue_notification(
    v_owner_id,
    'electricity-charge:' || NEW.bill_item_id::text,
    'electricity_charge_added',
    'Electricity charge added',
    format('An electricity charge of %s has been added to %s''s bill for %s.',
      to_char(NEW.amount, 'FM999999999990.00'),
      v_tenant_name,
      to_char(v_period_start, 'YYYY-MM')),
    'monthly_bill',
    v_bill_id,
    jsonb_build_object(
      'room_id', v_room_id,
      'boarding_house_id', v_boarding_house_id,
      'period', to_char(v_period_start, 'YYYY-MM')
    )
  );

  RETURN NEW;
END;
$function$;

CREATE TRIGGER notifications_electricity_charge
  AFTER INSERT ON public.bill_items
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_electricity_charge();

CREATE OR REPLACE FUNCTION private.create_bill_due_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_bill record;
  v_event_type text;
  v_title text;
  v_message text;
  v_event_suffix text;
BEGIN
  FOR v_bill IN
    SELECT bill.bill_id, bill.period_start, bill.due_date, tenancy.owner_id,
           room.room_id, room.room_name, room.boarding_house_id,
           tenant.name AS tenant_name
    FROM public.monthly_bill bill
    JOIN public.tenancy tenancy ON tenancy.tenancy_id = bill.tenancy_id
    JOIN public.rooms room ON room.room_id = tenancy.room_id
    JOIN public.tenants tenant ON tenant.tenant_id = tenancy.tenant_id
    WHERE bill.paid_at IS NULL
      AND bill.due_date IN (v_today, v_today + 2)
  LOOP
    IF v_bill.due_date = v_today + 2 THEN
      v_event_type := 'bill_due_soon';
      v_title := 'Bill due soon';
      v_message := format('The bill for %s is due on %s.',
        v_bill.room_name, v_bill.due_date);
      v_event_suffix := 'due-soon';
    ELSE
      v_event_type := 'bill_due_today';
      v_title := 'Bill due today';
      v_message := format('The bill for %s is due today.', v_bill.room_name);
      v_event_suffix := 'due-today';
    END IF;

    PERFORM private.enqueue_notification(
      v_bill.owner_id,
      v_event_suffix || ':' || v_bill.bill_id::text,
      v_event_type,
      v_title,
      v_message,
      'monthly_bill',
      v_bill.bill_id,
      jsonb_build_object(
        'room_id', v_bill.room_id,
        'boarding_house_id', v_bill.boarding_house_id,
        'period', to_char(v_bill.period_start, 'YYYY-MM')
      )
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION private.dispatch_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_project_url text;
  v_webhook_secret text;
BEGIN
  SELECT secret.decrypted_secret
  INTO v_project_url
  FROM vault.decrypted_secrets secret
  WHERE secret.name = 'notifications_supabase_url'
  LIMIT 1;

  SELECT secret.decrypted_secret
  INTO v_webhook_secret
  FROM vault.decrypted_secrets secret
  WHERE secret.name = 'notifications_webhook_secret'
  LIMIT 1;

  IF v_project_url IS NULL OR v_webhook_secret IS NULL THEN
    RAISE WARNING 'Push dispatch is not configured for notification %', NEW.notification_id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/send-notification-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-webhook-secret', v_webhook_secret
    ),
    body := jsonb_build_object('notification_id', NEW.notification_id)
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Could not queue push notification %: %',
      NEW.notification_id, SQLERRM;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER notifications_push_dispatch
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION private.dispatch_notification_push();

REVOKE ALL ON FUNCTION private.enqueue_notification(
  uuid, text, text, text, text, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_monthly_bill_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_tenancy_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_electricity_charge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.create_bill_due_notifications() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.dispatch_notification_push() FROM PUBLIC, anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

SELECT cron.schedule(
  'create-notification-due-reminders-daily',
  '10 16 * * *',
  'SELECT private.create_bill_due_notifications();'
);