


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."bill_item_type" AS ENUM (
    'rent',
    'water',
    'trash',
    'wifi',
    'electricity',
    'adjustment'
);


ALTER TYPE "public"."bill_item_type" OWNER TO "postgres";


CREATE TYPE "public"."reminder_type" AS ENUM (
    'owner_reading_due_soon',
    'owner_reading_due',
    'tenant_bill_sent'
);


ALTER TYPE "public"."reminder_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."build_bill_email_payload"("p_bill_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."build_bill_email_payload"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."create_bill_due_notifications"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."create_bill_due_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."dispatch_notification_push"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."dispatch_notification_push"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."enqueue_notification"("p_owner_id" "uuid", "p_event_key" "text", "p_type" "text", "p_title" "text", "p_message" "text", "p_related_record_type" "text", "p_related_record_id" "uuid", "p_data" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."enqueue_notification"("p_owner_id" "uuid", "p_event_key" "text", "p_type" "text", "p_title" "text", "p_message" "text", "p_related_record_type" "text", "p_related_record_id" "uuid", "p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."notify_electricity_charge"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "private"."notify_electricity_charge"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."notify_monthly_bill_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_owner_id uuid;
  v_room_id uuid;
  v_room_name text;
  v_boarding_house_id uuid;
  v_boarding_house_name text;
  v_room_label text;
  v_period text;
  v_route_data jsonb;
BEGIN
  v_period := to_char(NEW.period_start, 'YYYY-MM');

  SELECT tenancy.owner_id,
         tenancy.room_id,
         coalesce(room.room_name, archive.room_name),
         room.boarding_house_id,
         coalesce(house.name, archive.boarding_house_name)
  INTO v_owner_id,
       v_room_id,
       v_room_name,
       v_boarding_house_id,
       v_boarding_house_name
  FROM public.tenancy AS tenancy
  LEFT JOIN public.rooms AS room ON room.room_id = tenancy.room_id
  LEFT JOIN public.boarding_house AS house
    ON house.boarding_house_id = room.boarding_house_id
  LEFT JOIN public.tenant_archive AS archive
    ON archive.tenancy_id = tenancy.tenancy_id
  WHERE tenancy.tenancy_id = NEW.tenancy_id;

  IF v_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_room_label := CASE
    WHEN nullif(btrim(v_room_name), '') IS NOT NULL
      AND nullif(btrim(v_boarding_house_name), '') IS NOT NULL
      THEN btrim(v_room_name) || ' at ' || btrim(v_boarding_house_name)
    WHEN nullif(btrim(v_room_name), '') IS NOT NULL THEN btrim(v_room_name)
    WHEN nullif(btrim(v_boarding_house_name), '') IS NOT NULL
      THEN 'the room at ' || btrim(v_boarding_house_name)
    ELSE 'this room'
  END;

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
      format(
        'A bill for %s has been generated and is due %s.',
        v_room_label,
        NEW.due_date
      ),
      'monthly_bill',
      NEW.bill_id,
      v_route_data
    );

    IF coalesce(NEW.paid_at, NULL) IS NULL
       AND EXISTS (
         SELECT 1
         FROM public.tenancy_default_charges AS tenancy_charge
         WHERE tenancy_charge.tenancy_id = NEW.tenancy_id
           AND tenancy_charge.item_type = 'electricity'
         UNION ALL
         SELECT 1
         FROM public.owner_default_charges AS owner_charge
         WHERE owner_charge.owner_id = v_owner_id
           AND owner_charge.item_type = 'electricity'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.bill_items AS bill_item
         WHERE bill_item.bill_id = NEW.bill_id
           AND bill_item.item_type = 'electricity'
       ) THEN
      PERFORM private.enqueue_notification(
        v_owner_id,
        'meter-reading-required:' || NEW.bill_id::text,
        'meter_reading_required',
        'Electricity reading needed',
        format(
          'Add the electricity meter reading for %s to complete this bill.',
          v_room_label
        ),
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
      format(
        'The bill for %s (%s) has been marked as paid.',
        v_room_label,
        v_period
      ),
      'monthly_bill',
      NEW.bill_id,
      v_route_data
    );
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Could not create monthly bill notification for %: %',
      NEW.bill_id,
      SQLERRM;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "private"."notify_monthly_bill_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."notify_tenancy_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_tenant_name text;
  v_room_name text;
  v_boarding_house_id uuid;
  v_boarding_house_name text;
  v_room_label text;
  v_route_data jsonb;
BEGIN
  SELECT tenant.name,
         coalesce(room.room_name, archive.room_name),
         room.boarding_house_id,
         coalesce(house.name, archive.boarding_house_name)
  INTO v_tenant_name,
       v_room_name,
       v_boarding_house_id,
       v_boarding_house_name
  FROM public.tenants AS tenant
  LEFT JOIN public.rooms AS room ON room.room_id = NEW.room_id
  LEFT JOIN public.boarding_house AS house
    ON house.boarding_house_id = room.boarding_house_id
  LEFT JOIN public.tenant_archive AS archive
    ON archive.tenancy_id = NEW.tenancy_id
  WHERE tenant.tenant_id = NEW.tenant_id;

  IF v_tenant_name IS NULL THEN
    RETURN NEW;
  END IF;

  v_room_label := CASE
    WHEN nullif(btrim(v_room_name), '') IS NOT NULL
      AND nullif(btrim(v_boarding_house_name), '') IS NOT NULL
      THEN btrim(v_room_name) || ' at ' || btrim(v_boarding_house_name)
    WHEN nullif(btrim(v_room_name), '') IS NOT NULL THEN btrim(v_room_name)
    WHEN nullif(btrim(v_boarding_house_name), '') IS NOT NULL
      THEN 'the room at ' || btrim(v_boarding_house_name)
    ELSE 'this room'
  END;

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
      format(
        '%s has been registered for %s.',
        v_tenant_name,
        v_room_label
      ),
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
        format(
          '%s has moved into %s.',
          v_tenant_name,
          v_room_label
        ),
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
        format(
          '%s has moved into %s.',
          v_tenant_name,
          v_room_label
        ),
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
        format(
          '%s''s tenancy in %s has ended.',
          v_tenant_name,
          v_room_label
        ),
        'tenancy',
        NEW.tenancy_id,
        v_route_data
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Could not create tenancy notification for %: %',
      NEW.tenancy_id,
      SQLERRM;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "private"."notify_tenancy_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."tenant_document_is_referenced"("p_path" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  IF p_path IS NULL
     OR auth.uid() IS NULL
     OR split_part(p_path, '/', 1) <> auth.uid()::text THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.tenants tenant
    WHERE tenant.id_photo_url = p_path
  )
  OR EXISTS (
    SELECT 1
    FROM public.tenancy tenancy
    WHERE tenancy.agreement_photo_url = p_path
  )
  OR EXISTS (
    SELECT 1
    FROM public.tenant_archive archive
    WHERE archive.id_photo_path = p_path
       OR archive.agreement_photo_path = p_path
  );
END;
$$;


ALTER FUNCTION "private"."tenant_document_is_referenced"("p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_tenancy"("p_tenancy_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN RAISE EXCEPTION 'Move-out details are required to archive a tenant'; END;
$$;


ALTER FUNCTION "public"."archive_tenancy"("p_tenancy_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_tenancy_with_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text", "p_reading_value" numeric DEFAULT NULL::numeric, "p_reading_at" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_owner_id uuid := auth.uid(); v_tenancy public.tenancy%ROWTYPE; v_preview jsonb; v_final_bill public.monthly_bill%ROWTYPE;
  v_reading public.meter_readings%ROWTYPE; v_previous public.meter_readings%ROWTYPE; v_existing public.meter_readings%ROWTYPE; v_item public.bill_items%ROWTYPE;
  v_archive_id uuid; v_period_start date; v_rate numeric; v_units numeric; v_zero_span boolean; v_bill_id uuid;
BEGIN
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF p_electricity_option IS NULL OR p_electricity_option NOT IN ('reading', 'no_charge') THEN RAISE EXCEPTION 'Choose Enter final meter reading or No electricity charge for this bill'; END IF;
  SELECT tenancy.* INTO v_tenancy FROM public.tenancy AS tenancy WHERE tenancy.tenancy_id = p_tenancy_id AND tenancy.owner_id = v_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenancy not found or not authorized'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('meter:' || v_tenancy.room_id::text, 0));
  PERFORM 1 FROM public.monthly_bill WHERE tenancy_id = p_tenancy_id FOR UPDATE;
  SELECT public.preview_tenant_move_out(p_tenancy_id, p_move_out_date, p_electricity_option, p_reading_value, p_reading_at) INTO v_preview;
  v_period_start := (v_preview ->> 'periodStart')::date; v_zero_span := coalesce((v_preview ->> 'zeroSpan')::boolean, false); v_bill_id := nullif(v_preview ->> 'billId', '')::uuid;
  DELETE FROM public.bill_items WHERE bill_id IN (SELECT bill_id FROM public.monthly_bill WHERE tenancy_id = p_tenancy_id AND period_start > p_move_out_date);
  DELETE FROM public.monthly_bill WHERE tenancy_id = p_tenancy_id AND period_start > p_move_out_date;
  IF v_bill_id IS NULL THEN v_bill_id := public.generate_monthly_bill(p_tenancy_id, v_period_start, p_move_out_date, p_move_out_date); END IF;
  UPDATE public.monthly_bill SET period_end = p_move_out_date, due_date = p_move_out_date, updated_at = now() WHERE bill_id = v_bill_id;
  SELECT * INTO v_final_bill FROM public.monthly_bill WHERE bill_id = v_bill_id FOR UPDATE;
  IF p_electricity_option = 'reading' THEN
    SELECT * INTO v_existing FROM public.meter_readings WHERE room_id = v_tenancy.room_id AND reading_at = p_reading_at FOR UPDATE;
    IF FOUND THEN
      IF v_existing.reading_value <> p_reading_value THEN RAISE EXCEPTION 'A different meter reading is already saved for the final reading date'; END IF;
      v_reading := v_existing;
    ELSE
      PERFORM set_config('inkeeper.final_move_out_room_id', v_tenancy.room_id::text, true);
      INSERT INTO public.meter_readings (room_id, reading_value, reading_at) VALUES (v_tenancy.room_id, p_reading_value, p_reading_at) RETURNING * INTO v_reading;
    END IF;
    SELECT * INTO v_item FROM public.bill_items WHERE bill_id = v_bill_id AND item_type = 'electricity' ORDER BY bill_item_id LIMIT 1;
    IF v_item.bill_item_id IS NULL THEN
      SELECT * INTO v_previous FROM public.meter_readings WHERE room_id = v_tenancy.room_id AND reading_at < p_reading_at AND reading_at >= v_tenancy.move_in_date ORDER BY reading_at DESC, reading_id DESC LIMIT 1;
      SELECT coalesce(tenancy_charge.unit_price, owner_charge.unit_price) INTO v_rate FROM public.tenancy AS tenancy LEFT JOIN public.tenancy_default_charges AS tenancy_charge ON tenancy_charge.tenancy_id = tenancy.tenancy_id AND tenancy_charge.item_type = 'electricity' LEFT JOIN public.owner_default_charges AS owner_charge ON owner_charge.owner_id = tenancy.owner_id AND owner_charge.item_type = 'electricity' WHERE tenancy.tenancy_id = p_tenancy_id;
      v_units := p_reading_value - coalesce(v_previous.reading_value, p_reading_value);
      IF v_zero_span OR v_previous.reading_id IS NULL THEN
        INSERT INTO public.bill_items (bill_id, item_type, description, quantity, unit_price) VALUES (v_bill_id, 'adjustment', 'Electricity', 0, v_rate);
      ELSE
        PERFORM set_config('inkeeper.final_move_out_bill_id', v_bill_id::text, true);
        INSERT INTO public.bill_items (bill_id, item_type, quantity, unit_price, start_reading_id, end_reading_id) VALUES (v_bill_id, 'electricity', v_units, v_rate, v_previous.reading_id, v_reading.reading_id);
      END IF;
    END IF;
  ELSE
    INSERT INTO public.bill_items (bill_id, item_type, description, quantity, unit_price) VALUES (v_bill_id, 'adjustment', 'Electricity not charged', 0, 0);
  END IF;
  UPDATE public.tenancy SET move_out_date = p_move_out_date WHERE tenancy_id = p_tenancy_id;
  SELECT archive_id INTO v_archive_id FROM public.tenant_archive WHERE tenancy_id = p_tenancy_id;
  IF v_archive_id IS NULL THEN RAISE EXCEPTION 'The tenant could not be archived'; END IF;
  IF p_electricity_option = 'reading' THEN
    IF NOT EXISTS (SELECT 1 FROM public.bill_items AS item WHERE item.bill_id = v_bill_id AND (item.item_type = 'electricity' OR (item.item_type = 'adjustment' AND item.description = 'Electricity'))) THEN RAISE EXCEPTION 'The final meter reading could not be saved on the final bill'; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.bill_items AS item WHERE item.bill_id = v_bill_id AND item.item_type = 'adjustment' AND item.description = 'Electricity not charged') THEN RAISE EXCEPTION 'The no-electricity-charge exception could not be saved'; END IF;
  RETURN jsonb_build_object('archiveId', v_archive_id, 'billId', v_bill_id, 'moveOutDate', p_move_out_date, 'electricityOption', p_electricity_option, 'total', (SELECT total_amount FROM public.monthly_bill WHERE bill_id = v_bill_id));
END;
$$;


ALTER FUNCTION "public"."archive_tenancy_with_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text", "p_reading_value" numeric, "p_reading_at" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_archive_tenancy"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$begin
  -- a mistaken move-out date was corrected: undo the archive entry
  if tg_op = 'UPDATE' and old.status = 'ended' and new.status <> 'ended' then
    delete from public.tenant_archive where tenancy_id = new.tenancy_id;
    return null;
  end if;

  if new.status = 'ended' and (tg_op = 'INSERT' or old.status is distinct from 'ended') then
    insert into public.tenant_archive (
      owner_id, tenant_id, tenancy_id, tenant_name, contact_number, email_address,
      move_in_date, move_out_date, room_name, boarding_house_name,
      boarding_house_address, id_photo_path, agreement_photo_path)
    select ty.owner_id, t.tenant_id, ty.tenancy_id, t.name, t.contact_number, t.email_address,
           ty.move_in_date, ty.move_out_date, r.room_name, bh.name, bh.address,
           t.id_photo_url, ty.agreement_photo_url
    from public.tenancy ty
    join public.tenants t on t.tenant_id = ty.tenant_id
    join public.rooms r on r.room_id = ty.room_id
    join public.boarding_house bh on bh.boarding_house_id = r.boarding_house_id
    where ty.tenancy_id = new.tenancy_id
    on conflict (tenancy_id) do nothing;
  end if;

  return null;
end;$$;


ALTER FUNCTION "public"."auto_archive_tenancy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_finalized_bill_edit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_bill_id uuid := coalesce(new.bill_id, old.bill_id);
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.monthly_bill
    WHERE bill_id = v_bill_id
      AND billed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Bill % is finalized; its items cannot be changed', v_bill_id;
  END IF;
  RETURN coalesce(new, old);
END;
$$;


ALTER FUNCTION "public"."block_finalized_bill_edit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_bill_electricity_roll_forward"("p_source_bill_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_source public.monthly_bill%ROWTYPE;
  v_target public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT * INTO v_source
  FROM public.monthly_bill
  WHERE bill_id = p_source_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;
  IF v_source.electricity_roll_forward_to_bill_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_source.tenancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill tenancy not found or not authorized';
  END IF;

  SELECT * INTO v_target
  FROM public.monthly_bill
  WHERE bill_id = v_source.electricity_roll_forward_to_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The later bill could not be found';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || v_tenancy.room_id::text, 0)
  );

  SELECT * INTO v_source
  FROM public.monthly_bill
  WHERE bill_id = p_source_bill_id
  FOR UPDATE;

  IF v_source.billed_at IS NOT NULL
     OR coalesce(v_source.is_paid, false)
     OR v_source.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'A completed, issued, or paid carry-forward cannot be cancelled';
  END IF;

  IF v_target.billed_at IS NOT NULL
     OR coalesce(v_target.is_paid, false)
     OR v_target.paid_at IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.bill_items
       WHERE bill_id = v_target.bill_id
         AND item_type = 'electricity'
     )
     OR EXISTS (
       SELECT 1
       FROM public.meter_readings
       WHERE room_id = v_tenancy.room_id
         AND reading_at > v_source.period_end
     ) THEN
    RAISE EXCEPTION 'A later reading already exists; this carry-forward cannot be cancelled safely';
  END IF;

  UPDATE public.monthly_bill
  SET electricity_roll_forward_to_bill_id = NULL
  WHERE bill_id = v_source.bill_id;
END;
$$;


ALTER FUNCTION "public"."cancel_bill_electricity_roll_forward"("p_source_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."carry_forward_bill_electricity"("p_source_bill_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_source public.monthly_bill%ROWTYPE;
  v_target public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
  v_electricity_item public.bill_items%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_target_bill_id uuid;
  v_completed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT * INTO v_source
  FROM public.monthly_bill
  WHERE bill_id = p_source_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_source.tenancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill tenancy not found or not authorized';
  END IF;

  IF v_source.electricity_roll_forward_to_bill_id IS NOT NULL THEN
    v_target_bill_id := v_source.electricity_roll_forward_to_bill_id;
  ELSE
    SELECT bill_id INTO v_target_bill_id
    FROM public.monthly_bill
    WHERE tenancy_id = v_source.tenancy_id
      AND period_start > v_source.period_end
    ORDER BY period_start
    LIMIT 1;
  END IF;

  IF v_target_bill_id IS NULL THEN
    RAISE EXCEPTION 'There is no later generated bill to receive this electricity usage';
  END IF;

  SELECT * INTO v_target
  FROM public.monthly_bill
  WHERE bill_id = v_target_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The later bill could not be found';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || v_tenancy.room_id::text, 0)
  );

  SELECT * INTO v_source
  FROM public.monthly_bill
  WHERE bill_id = p_source_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;

  IF v_target.tenancy_id <> v_source.tenancy_id
     OR v_target.period_start <= v_source.period_end THEN
    RAISE EXCEPTION 'Carry-forward must target a later bill for the same tenancy';
  END IF;

  IF v_source.electricity_roll_forward_to_bill_id IS NOT NULL
     AND v_source.electricity_roll_forward_to_bill_id <> v_target.bill_id THEN
    RAISE EXCEPTION 'This bill is already linked to a different carry-forward bill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bill_items
    WHERE bill_id = v_source.bill_id
      AND (
        item_type = 'electricity'
        OR (item_type = 'adjustment' AND description = 'Electricity')
      )
  ) THEN
    RAISE EXCEPTION 'This bill already has an electricity charge';
  END IF;

  SELECT * INTO v_electricity_item
  FROM public.bill_items
  WHERE bill_id = v_target.bill_id
    AND item_type = 'electricity'
  ORDER BY bill_item_id
  LIMIT 1;

  IF v_electricity_item.bill_item_id IS NOT NULL THEN
    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE reading_id = v_electricity_item.start_reading_id;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE reading_id = v_electricity_item.end_reading_id;

    IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL
       OR v_start.reading_at > v_source.period_start
       OR v_end.reading_at < v_source.period_end THEN
      RAISE EXCEPTION 'The later bill does not contain the full missed-period reading interval';
    END IF;
    v_completed := true;
  ELSIF EXISTS (
    SELECT 1
    FROM public.bill_items
    WHERE bill_id = v_target.bill_id
      AND item_type = 'adjustment'
      AND description = 'Electricity'
  ) THEN
    RAISE EXCEPTION 'The later bill already has a manual electricity charge';
  ELSIF v_target.billed_at IS NOT NULL OR coalesce(v_target.is_paid, false)
        OR v_target.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'The later bill is finalized but does not contain this missed-period usage';
  ELSE
    IF v_source.billed_at IS NOT NULL
       OR coalesce(v_source.is_paid, false)
       OR v_source.paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'An issued or paid bill cannot be changed by carry-forward';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.meter_readings
      WHERE room_id = v_tenancy.room_id
        AND reading_at >= v_tenancy.move_in_date
        AND reading_at <= v_source.period_start
    ) THEN
      RAISE EXCEPTION 'An opening reading before this bill period is required for carry-forward';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.meter_readings
      WHERE room_id = v_tenancy.room_id
        AND reading_at > v_source.period_start
        AND reading_at <= v_source.period_end
    ) THEN
      RAISE EXCEPTION 'A reading already exists in this bill period. Use late reading instead';
    END IF;
  END IF;

  IF v_source.billed_at IS NOT NULL
     OR coalesce(v_source.is_paid, false)
     OR v_source.paid_at IS NOT NULL THEN
    IF v_source.electricity_roll_forward_to_bill_id = v_target.bill_id
       AND v_completed THEN
      RETURN jsonb_build_object(
        'targetBillId', v_target.bill_id,
        'targetPeriodStart', v_target.period_start,
        'status', 'completed'
      );
    END IF;
    RAISE EXCEPTION 'An issued or paid bill cannot be changed by carry-forward';
  END IF;

  UPDATE public.monthly_bill
  SET electricity_roll_forward_to_bill_id = v_target.bill_id,
      billed_at = CASE WHEN v_completed THEN now() ELSE billed_at END
  WHERE bill_id = v_source.bill_id;

  RETURN jsonb_build_object(
    'targetBillId', v_target.bill_id,
    'targetPeriodStart', v_target.period_start,
    'status', CASE WHEN v_completed THEN 'completed' ELSE 'pending' END
  );
END;
$$;


ALTER FUNCTION "public"."carry_forward_bill_electricity"("p_source_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_tenant_bill_resend"("p_bill_id" "uuid", "p_request_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."claim_tenant_bill_resend"("p_bill_id" "uuid", "p_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."correct_bill_meter_reading"("p_bill_id" "uuid", "p_new_reading_value" numeric, "p_request_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_bill public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_expected_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_latest public.meter_readings%ROWTYPE;
  v_existing public.bill_meter_reading_corrections%ROWTYPE;
  v_usage numeric;
  v_amount numeric;
  v_total numeric;
  v_corrected_at timestamptz;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'IK010', MESSAGE = 'Monthly bill not found or not authorized', HINT = 'not_authorized';
  END IF;
  IF p_bill_id IS NULL OR p_request_id IS NULL OR length(btrim(p_request_id)) < 8 OR length(p_request_id) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'IK00C', MESSAGE = 'A valid correction request is required', HINT = 'invalid_request';
  END IF;
  IF p_new_reading_value IS NULL OR p_new_reading_value < 0 OR p_new_reading_value >= 'Infinity'::numeric OR p_new_reading_value = 'NaN'::numeric THEN
    RAISE EXCEPTION USING ERRCODE = 'IK008', MESSAGE = 'Enter a valid nonnegative meter reading', HINT = 'value_negative';
  END IF;

  SELECT * INTO v_existing FROM public.bill_meter_reading_corrections WHERE owner_id = v_owner_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.bill_id <> p_bill_id OR v_existing.new_value <> p_new_reading_value THEN
      RAISE EXCEPTION USING ERRCODE = 'IK00D', MESSAGE = 'This correction request was already used for a different change', HINT = 'request_reused';
    END IF;
    RETURN jsonb_build_object('corrected', true, 'alreadyApplied', true, 'correctionId', v_existing.correction_id, 'billId', v_existing.bill_id, 'readingId', v_existing.reading_id, 'oldValue', v_existing.old_value, 'newValue', v_existing.new_value, 'correctedAt', v_existing.corrected_at, 'usage', v_existing.usage, 'rate', v_existing.unit_price, 'electricityCharge', v_existing.electricity_charge, 'totalAmount', v_existing.total_amount);
  END IF;

  SELECT bill.* INTO v_bill
  FROM public.monthly_bill AS bill
  JOIN public.tenancy AS tenancy ON tenancy.tenancy_id = bill.tenancy_id
  WHERE bill.bill_id = p_bill_id AND tenancy.owner_id = v_owner_id
  FOR UPDATE OF bill;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IK010', MESSAGE = 'Monthly bill not found or not authorized', HINT = 'not_authorized';
  END IF;

  SELECT * INTO v_existing FROM public.bill_meter_reading_corrections WHERE owner_id = v_owner_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.bill_id <> p_bill_id OR v_existing.new_value <> p_new_reading_value THEN
      RAISE EXCEPTION USING ERRCODE = 'IK00D', MESSAGE = 'This correction request was already used for a different change', HINT = 'request_reused';
    END IF;
    RETURN jsonb_build_object('corrected', true, 'alreadyApplied', true, 'correctionId', v_existing.correction_id, 'billId', v_existing.bill_id, 'readingId', v_existing.reading_id, 'oldValue', v_existing.old_value, 'newValue', v_existing.new_value, 'correctedAt', v_existing.corrected_at, 'usage', v_existing.usage, 'rate', v_existing.unit_price, 'electricityCharge', v_existing.electricity_charge, 'totalAmount', v_existing.total_amount);
  END IF;

  IF v_bill.billed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'IK001', MESSAGE = 'This bill is finalized and can no longer be changed.', HINT = 'bill_finalized';
  END IF;
  IF coalesce(v_bill.is_paid, false) OR v_bill.paid_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'IK002', MESSAGE = 'This bill is paid, so the reading cannot be changed.', HINT = 'bill_paid';
  END IF;

  SELECT * INTO v_tenancy FROM public.tenancy WHERE tenancy_id = v_bill.tenancy_id AND owner_id = v_owner_id FOR UPDATE;
  IF NOT FOUND OR v_tenancy.status <> 'active' OR v_tenancy.room_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'IK007', MESSAGE = 'Only an active tenant''s bill reading can be corrected.', HINT = 'tenant_not_active';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_archive WHERE tenancy_id = v_tenancy.tenancy_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'IK007', MESSAGE = 'Only an active tenant''s bill reading can be corrected.', HINT = 'tenant_not_active';
  END IF;
  IF v_bill.electricity_roll_forward_to_bill_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.monthly_bill AS source WHERE source.electricity_roll_forward_to_bill_id = v_bill.bill_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'IK004', MESSAGE = 'This reading is part of a carry-forward and cannot be changed.', HINT = 'carry_forward_chain';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('meter:' || v_tenancy.room_id::text, 0));

  SELECT * INTO v_item FROM public.bill_items WHERE bill_id = v_bill.bill_id AND item_type = 'electricity' ORDER BY bill_item_id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IK011', MESSAGE = 'There is no saved meter reading on this bill', HINT = 'invalid_reading_link';
  END IF;

  SELECT * INTO v_start FROM public.meter_readings WHERE reading_id = v_item.start_reading_id;
  SELECT * INTO v_end FROM public.meter_readings WHERE reading_id = v_item.end_reading_id FOR UPDATE;
  IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL OR v_start.room_id <> v_tenancy.room_id OR v_end.room_id <> v_tenancy.room_id THEN
    RAISE EXCEPTION USING ERRCODE = 'IK011', MESSAGE = 'The bill meter reading is not valid', HINT = 'invalid_reading_link';
  END IF;
  IF v_end.reading_at = v_tenancy.move_in_date THEN
    RAISE EXCEPTION USING ERRCODE = 'IK005', MESSAGE = 'The tenant''s move-in reading cannot be changed.', HINT = 'move_in_reading';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meter_readings WHERE room_id = v_tenancy.room_id AND reading_at < v_end.reading_at) THEN
    RAISE EXCEPTION USING ERRCODE = 'IK006', MESSAGE = 'The initial meter reading cannot be changed.', HINT = 'initial_reading';
  END IF;

  SELECT * INTO v_expected_start
  FROM public.meter_readings
  WHERE room_id = v_tenancy.room_id
    AND reading_at < v_end.reading_at
    AND reading_at >= v_tenancy.move_in_date
    AND (v_tenancy.move_out_date IS NULL OR reading_at <= v_tenancy.move_out_date)
  ORDER BY reading_at DESC, reading_id DESC LIMIT 1;
  IF v_expected_start.reading_id IS DISTINCT FROM v_start.reading_id THEN
    RAISE EXCEPTION USING ERRCODE = 'IK015', MESSAGE = 'A different previous reading exists, so this bill cannot be corrected.', HINT = 'previous_reading_mismatch';
  END IF;

  SELECT * INTO v_latest FROM public.meter_readings WHERE room_id = v_tenancy.room_id ORDER BY reading_at DESC, reading_id DESC LIMIT 1;
  IF v_latest.reading_id IS DISTINCT FROM v_end.reading_id THEN
    RAISE EXCEPTION USING ERRCODE = 'IK003', MESSAGE = 'A later reading exists. Only the latest reading can be corrected.', HINT = 'not_latest_reading';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bill_items AS other_item WHERE other_item.item_type = 'electricity' AND other_item.end_reading_id = v_end.reading_id AND other_item.bill_item_id <> v_item.bill_item_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'IK012', MESSAGE = 'This meter reading is already attached to another bill', HINT = 'reading_attached_elsewhere';
  END IF;
  IF p_new_reading_value < v_start.reading_value THEN
    RAISE EXCEPTION USING ERRCODE = 'IK009', MESSAGE = 'The new reading cannot be lower than the previous reading.', HINT = 'value_below_previous';
  END IF;
  IF p_new_reading_value = v_end.reading_value THEN
    RAISE EXCEPTION USING ERRCODE = 'IK014', MESSAGE = 'The new reading must be different from the saved reading', HINT = 'reading_unchanged';
  END IF;

  v_usage := p_new_reading_value - v_start.reading_value;
  v_amount := v_usage * v_item.unit_price;

  UPDATE public.meter_readings SET reading_value = p_new_reading_value WHERE reading_id = v_end.reading_id;
  UPDATE public.bill_items SET quantity = v_usage WHERE bill_item_id = v_item.bill_item_id;

  SELECT total_amount INTO v_total FROM public.monthly_bill WHERE bill_id = v_bill.bill_id;
  v_corrected_at := now();

  INSERT INTO public.bill_meter_reading_corrections (owner_id, request_id, bill_id, reading_id, old_value, new_value, corrected_at, usage, unit_price, electricity_charge, total_amount)
  VALUES (v_owner_id, p_request_id, v_bill.bill_id, v_end.reading_id, v_end.reading_value, p_new_reading_value, v_corrected_at, v_usage, v_item.unit_price, v_amount, v_total)
  RETURNING correction_id INTO v_existing.correction_id;

  RETURN jsonb_build_object('corrected', true, 'alreadyApplied', false, 'correctionId', v_existing.correction_id, 'billId', v_bill.bill_id, 'readingId', v_end.reading_id, 'oldValue', v_end.reading_value, 'newValue', p_new_reading_value, 'correctedAt', v_corrected_at, 'usage', v_usage, 'rate', v_item.unit_price, 'electricityCharge', v_amount, 'totalAmount', v_total);
END;
$$;


ALTER FUNCTION "public"."correct_bill_meter_reading"("p_bill_id" "uuid", "p_new_reading_value" numeric, "p_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_room_with_meter_reading"("p_boarding_house_id" "uuid", "p_room_name" "text", "p_monthly_rate" numeric, "p_request_id" "text", "p_initial_reading_value" numeric, "p_initial_reading_at" "date") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_room_id uuid;
  v_existing public.room_creation_requests%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_request_id IS NULL OR length(p_request_id) < 10 OR length(p_request_id) > 80 THEN
    RAISE EXCEPTION 'A valid room creation request identifier is required';
  END IF;

  IF p_room_name IS NULL OR btrim(p_room_name) = ''
     OR length(btrim(p_room_name)) > 30
     OR p_monthly_rate IS NULL
     OR p_monthly_rate <= 0
     OR p_monthly_rate >= 'Infinity'::numeric
     OR p_monthly_rate = 'NaN'::numeric THEN
    RAISE EXCEPTION 'A room name and valid monthly rate are required';
  END IF;

  IF (p_initial_reading_value IS NULL) <> (p_initial_reading_at IS NULL) THEN
    RAISE EXCEPTION 'Both the initial meter reading and reading date are required';
  END IF;

  IF p_initial_reading_value IS NOT NULL
     AND (
       p_initial_reading_value < 0
       OR p_initial_reading_value >= 'Infinity'::numeric
       OR p_initial_reading_value = 'NaN'::numeric
     ) THEN
    RAISE EXCEPTION 'The initial meter reading must be a valid nonnegative value';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':' || p_request_id, 0)
  );

  SELECT *
  INTO v_existing
  FROM public.room_creation_requests
  WHERE owner_id = v_owner_id
    AND request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.boarding_house_id <> p_boarding_house_id
       OR v_existing.room_name <> btrim(p_room_name)
       OR v_existing.monthly_rate <> p_monthly_rate
       OR v_existing.initial_reading_value IS DISTINCT FROM p_initial_reading_value
       OR v_existing.initial_reading_at IS DISTINCT FROM p_initial_reading_at THEN
      RAISE EXCEPTION 'This room creation request was already completed with different details';
    END IF;
    RETURN v_existing.room_id;
  END IF;

  INSERT INTO public.rooms (boarding_house_id, room_name, monthly_rate)
  VALUES (p_boarding_house_id, btrim(p_room_name), p_monthly_rate)
  RETURNING room_id INTO v_room_id;

  IF p_initial_reading_value IS NOT NULL THEN
    INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
    VALUES (v_room_id, p_initial_reading_value, p_initial_reading_at);
  END IF;

  INSERT INTO public.room_creation_requests (
    owner_id,
    request_id,
    room_id,
    boarding_house_id,
    room_name,
    monthly_rate,
    initial_reading_value,
    initial_reading_at
  )
  VALUES (
    v_owner_id,
    p_request_id,
    v_room_id,
    p_boarding_house_id,
    btrim(p_room_name),
    p_monthly_rate,
    p_initial_reading_value,
    p_initial_reading_at
  );

  RETURN v_room_id;
END;
$$;


ALTER FUNCTION "public"."create_room_with_meter_reading"("p_boarding_house_id" "uuid", "p_room_name" "text", "p_monthly_rate" numeric, "p_request_id" "text", "p_initial_reading_value" numeric, "p_initial_reading_at" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cycle_date"("p_anchor" "date", "p_month" "date") RETURNS "date"
    LANGUAGE "sql" STABLE
    AS $$
  select least(
    date_trunc('month', p_month)::date + (extract(day from p_anchor)::int - 1),
    (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date
  );
$$;


ALTER FUNCTION "public"."cycle_date"("p_anchor" "date", "p_month" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_boarding_houses"("p_boarding_house_ids" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_house_id uuid;
  v_house_count integer := 0;
  v_deleted_house_count integer;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_boarding_house_ids IS NULL
     OR pg_catalog.cardinality(p_boarding_house_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one boarding house';
  END IF;

  FOR v_house_id IN
    SELECT house.boarding_house_id
    FROM public.boarding_house AS house
    WHERE house.boarding_house_id = ANY (p_boarding_house_ids)
      AND house.owner_id = v_owner_id
    FOR UPDATE
  LOOP
    v_house_count := v_house_count + 1;
  END LOOP;

  IF v_house_count <> pg_catalog.cardinality(p_boarding_house_ids) THEN
    RAISE EXCEPTION 'One or more boarding houses were not found or are not authorized';
  END IF;

  PERFORM 1
  FROM public.rooms AS room
  WHERE room.boarding_house_id = ANY (p_boarding_house_ids)
  ORDER BY room.room_id
  FOR UPDATE;

  PERFORM 1
  FROM public.tenancy AS tenancy
  JOIN public.rooms AS room ON room.room_id = tenancy.room_id
  WHERE room.boarding_house_id = ANY (p_boarding_house_ids)
  ORDER BY tenancy.tenancy_id
  FOR UPDATE OF tenancy;

  IF EXISTS (
    SELECT 1
    FROM public.tenancy AS tenancy
    JOIN public.rooms AS room ON room.room_id = tenancy.room_id
    JOIN public.tenants AS tenant ON tenant.tenant_id = tenancy.tenant_id
    WHERE room.boarding_house_id = ANY (p_boarding_house_ids)
      AND (
        tenancy.owner_id <> v_owner_id
        OR tenant.owner_id <> v_owner_id
      )
  ) THEN
    RAISE EXCEPTION 'A tenant record does not belong to the selected boarding house owner';
  END IF;

  INSERT INTO public.tenant_archive (
    owner_id,
    tenant_id,
    tenancy_id,
    tenant_name,
    contact_number,
    email_address,
    move_in_date,
    move_out_date,
    room_name,
    boarding_house_name,
    boarding_house_address,
    id_photo_path,
    agreement_photo_path
  )
  SELECT
    tenancy.owner_id,
    tenant.tenant_id,
    tenancy.tenancy_id,
    tenant.name,
    tenant.contact_number,
    tenant.email_address,
    coalesce(tenancy.move_in_date, v_today),
    CASE
      WHEN tenancy.status IN ('active', 'scheduled')
        THEN greatest(v_today, coalesce(tenancy.move_in_date, v_today))
      ELSE coalesce(
        tenancy.move_out_date,
        greatest(v_today, coalesce(tenancy.move_in_date, v_today))
      )
    END,
    room.room_name,
    house.name,
    house.address,
    tenant.id_photo_url,
    tenancy.agreement_photo_url
  FROM public.tenancy AS tenancy
  JOIN public.tenants AS tenant ON tenant.tenant_id = tenancy.tenant_id
  JOIN public.rooms AS room ON room.room_id = tenancy.room_id
  JOIN public.boarding_house AS house ON house.boarding_house_id = room.boarding_house_id
  WHERE room.boarding_house_id = ANY (p_boarding_house_ids)
    AND tenancy.owner_id = v_owner_id
  ON CONFLICT (tenancy_id) DO NOTHING;

  UPDATE public.tenancy AS tenancy
  SET move_out_date = greatest(v_today, coalesce(tenancy.move_in_date, v_today)),
      status = 'ended'
  FROM public.rooms AS room
  WHERE room.room_id = tenancy.room_id
    AND room.boarding_house_id = ANY (p_boarding_house_ids)
    AND tenancy.status IN ('active', 'scheduled');

  UPDATE public.tenancy AS tenancy
  SET room_id = NULL
  FROM public.rooms AS room
  WHERE room.room_id = tenancy.room_id
    AND room.boarding_house_id = ANY (p_boarding_house_ids);

  UPDATE public.meter_readings AS reading
  SET room_id = NULL
  FROM public.rooms AS room
  WHERE room.room_id = reading.room_id
    AND room.boarding_house_id = ANY (p_boarding_house_ids);

  DELETE FROM public.room_default_charges AS charge
  USING public.rooms AS room
  WHERE charge.rooom_id = room.room_id
    AND room.boarding_house_id = ANY (p_boarding_house_ids);

  DELETE FROM public.rooms AS room
  WHERE room.boarding_house_id = ANY (p_boarding_house_ids);

  DELETE FROM public.boarding_house AS house
  WHERE house.boarding_house_id = ANY (p_boarding_house_ids)
    AND house.owner_id = v_owner_id;
  GET DIAGNOSTICS v_deleted_house_count = ROW_COUNT;

  IF v_deleted_house_count <> v_house_count THEN
    RAISE EXCEPTION 'Not all selected boarding houses could be deleted';
  END IF;

  RETURN v_deleted_house_count;
END;
$$;


ALTER FUNCTION "public"."delete_boarding_houses"("p_boarding_house_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_rooms_with_tenant_archive"("p_boarding_house_id" "uuid", "p_room_ids" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_room_id uuid;
  v_room_count integer := 0;
  v_deleted_count integer;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_room_ids IS NULL OR pg_catalog.cardinality(p_room_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one room';
  END IF;

  PERFORM 1 FROM public.boarding_house AS house
  WHERE house.boarding_house_id = p_boarding_house_id
    AND house.owner_id = v_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Boarding house not found or not authorized';
  END IF;

  FOR v_room_id IN
    SELECT room.room_id FROM public.rooms AS room
    WHERE room.room_id = ANY (p_room_ids)
      AND room.boarding_house_id = p_boarding_house_id
    ORDER BY room.room_id
    FOR UPDATE
  LOOP
    v_room_count := v_room_count + 1;
  END LOOP;
  IF v_room_count <> pg_catalog.cardinality(p_room_ids) THEN
    RAISE EXCEPTION 'One or more rooms were not found or are not authorized';
  END IF;

  PERFORM 1 FROM public.tenancy AS tenancy
  WHERE tenancy.room_id = ANY (p_room_ids)
  ORDER BY tenancy.tenancy_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.tenancy AS tenancy
    JOIN public.tenants AS tenant ON tenant.tenant_id = tenancy.tenant_id
    LEFT JOIN public.tenant_archive AS archive ON archive.tenancy_id = tenancy.tenancy_id
    WHERE tenancy.room_id = ANY (p_room_ids)
      AND (tenancy.owner_id IS DISTINCT FROM v_owner_id
        OR tenant.owner_id IS DISTINCT FROM v_owner_id
        OR (archive.archive_id IS NOT NULL AND archive.owner_id IS DISTINCT FROM v_owner_id))
  ) THEN
    RAISE EXCEPTION 'A tenant record does not belong to the boarding house owner';
  END IF;

  INSERT INTO public.tenant_archive AS archive (
    owner_id, tenant_id, tenancy_id, tenant_name, contact_number, email_address,
    move_in_date, move_out_date, room_name, boarding_house_name,
    boarding_house_address, id_photo_path, agreement_photo_path
  )
  SELECT
    tenancy.owner_id, tenant.tenant_id, tenancy.tenancy_id, tenant.name,
    tenant.contact_number, tenant.email_address, coalesce(tenancy.move_in_date, v_today),
    CASE WHEN tenancy.status IN ('active', 'scheduled')
      THEN greatest(v_today, coalesce(tenancy.move_in_date, v_today))
      ELSE coalesce(tenancy.move_out_date, greatest(v_today, coalesce(tenancy.move_in_date, v_today)))
    END,
    room.room_name, house.name, house.address, tenant.id_photo_url, tenancy.agreement_photo_url
  FROM public.tenancy AS tenancy
  JOIN public.tenants AS tenant ON tenant.tenant_id = tenancy.tenant_id
  JOIN public.rooms AS room ON room.room_id = tenancy.room_id
  JOIN public.boarding_house AS house ON house.boarding_house_id = room.boarding_house_id
  WHERE room.room_id = ANY (p_room_ids)
  ON CONFLICT (tenancy_id) DO UPDATE SET
    room_name = coalesce(archive.room_name, EXCLUDED.room_name),
    boarding_house_name = coalesce(archive.boarding_house_name, EXCLUDED.boarding_house_name),
    boarding_house_address = coalesce(archive.boarding_house_address, EXCLUDED.boarding_house_address),
    id_photo_path = coalesce(archive.id_photo_path, EXCLUDED.id_photo_path),
    agreement_photo_path = coalesce(archive.agreement_photo_path, EXCLUDED.agreement_photo_path);

  UPDATE public.tenancy
  SET move_out_date = greatest(v_today, coalesce(move_in_date, v_today)), status = 'ended'
  WHERE room_id = ANY (p_room_ids) AND status IN ('active', 'scheduled');

  UPDATE public.tenancy SET room_id = NULL WHERE room_id = ANY (p_room_ids);
  UPDATE public.meter_readings SET room_id = NULL WHERE room_id = ANY (p_room_ids);
  DELETE FROM public.room_default_charges WHERE rooom_id = ANY (p_room_ids);
  DELETE FROM public.rooms
  WHERE room_id = ANY (p_room_ids) AND boarding_house_id = p_boarding_house_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> v_room_count THEN
    RAISE EXCEPTION 'Not all selected rooms could be deleted';
  END IF;
  RETURN v_deleted_count;
END;
$$;


ALTER FUNCTION "public"."delete_rooms_with_tenant_archive"("p_boarding_house_id" "uuid", "p_room_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."edit_room_with_rent_sync"("p_room_id" "uuid", "p_room_name" "text" DEFAULT NULL::"text", "p_monthly_rate" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_trimmed_name text := btrim(p_room_name);
  v_tenancy_count integer;
  v_updated_tenancy_count integer;
  v_rate_mismatches jsonb;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_room_name IS NULL AND p_monthly_rate IS NULL THEN
    RAISE EXCEPTION 'Provide a room name or monthly rent to update';
  END IF;
  IF p_room_name IS NOT NULL AND v_trimmed_name = '' THEN
    RAISE EXCEPTION 'Enter a room name';
  END IF;
  IF p_monthly_rate IS NOT NULL
     AND (
       p_monthly_rate <= 0
       OR p_monthly_rate > 99999999.99
       OR p_monthly_rate IS DISTINCT FROM round(p_monthly_rate, 2)
     ) THEN
    RAISE EXCEPTION 'Monthly rent must be greater than zero, at most 99,999,999.99, and have at most 2 decimal places';
  END IF;

  SELECT room.*
  INTO v_room
  FROM public.rooms AS room
  JOIN public.boarding_house AS house
    ON house.boarding_house_id = room.boarding_house_id
  WHERE room.room_id = p_room_id
    AND house.owner_id = v_owner_id
  FOR UPDATE OF room;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found or not authorized';
  END IF;

  IF p_room_name IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.rooms AS other_room
    WHERE other_room.boarding_house_id = v_room.boarding_house_id
      AND other_room.room_id <> p_room_id
      AND lower(btrim(other_room.room_name)) = lower(v_trimmed_name)
  ) THEN
    RAISE EXCEPTION 'This boarding house already has a room with this name'
      USING ERRCODE = '23505';
  END IF;

  PERFORM tenancy.tenancy_id
  FROM public.tenancy AS tenancy
  WHERE tenancy.room_id = p_room_id
    AND tenancy.status IN ('active', 'scheduled')
  ORDER BY tenancy.tenancy_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.tenancy AS tenancy
    JOIN public.tenants AS tenant ON tenant.tenant_id = tenancy.tenant_id
    WHERE tenancy.room_id = p_room_id
      AND tenancy.status IN ('active', 'scheduled')
      AND (
        tenancy.owner_id IS DISTINCT FROM v_owner_id
        OR tenant.owner_id IS DISTINCT FROM v_owner_id
      )
  ) THEN
    RAISE EXCEPTION 'A tenant record does not belong to the room owner';
  END IF;

  SELECT count(*)
  INTO v_tenancy_count
  FROM public.tenancy AS tenancy
  WHERE tenancy.room_id = p_room_id
    AND tenancy.status IN ('active', 'scheduled');

  IF p_monthly_rate IS NOT NULL THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'tenancy_id', tenancy.tenancy_id,
          'tenant_name', tenant.name,
          'previous_rate', tenancy.monthly_rate
        )
        ORDER BY tenancy.tenancy_id
      ),
      '[]'::jsonb
    )
    INTO v_rate_mismatches
    FROM public.tenancy AS tenancy
    JOIN public.tenants AS tenant ON tenant.tenant_id = tenancy.tenant_id
    WHERE tenancy.room_id = p_room_id
      AND tenancy.status IN ('active', 'scheduled')
      AND tenancy.monthly_rate IS DISTINCT FROM v_room.monthly_rate;
  ELSE
    v_rate_mismatches := '[]'::jsonb;
  END IF;

  IF p_room_name IS NOT NULL AND p_monthly_rate IS NOT NULL THEN
    UPDATE public.rooms
    SET room_name = v_trimmed_name, monthly_rate = p_monthly_rate
    WHERE room_id = p_room_id
    RETURNING * INTO v_room;
  ELSIF p_room_name IS NOT NULL THEN
    UPDATE public.rooms
    SET room_name = v_trimmed_name
    WHERE room_id = p_room_id
    RETURNING * INTO v_room;
  ELSE
    UPDATE public.rooms
    SET monthly_rate = p_monthly_rate
    WHERE room_id = p_room_id
    RETURNING * INTO v_room;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The room could not be updated';
  END IF;

  IF p_monthly_rate IS NOT NULL THEN
    UPDATE public.tenancy
    SET monthly_rate = p_monthly_rate
    WHERE room_id = p_room_id
      AND status IN ('active', 'scheduled');
    GET DIAGNOSTICS v_updated_tenancy_count = ROW_COUNT;

    IF v_updated_tenancy_count <> v_tenancy_count THEN
      RAISE EXCEPTION 'Not all current tenancies could be updated';
    END IF;

    SELECT count(*)
    INTO v_updated_tenancy_count
    FROM public.tenancy
    WHERE room_id = p_room_id
      AND status IN ('active', 'scheduled')
      AND monthly_rate = p_monthly_rate;

    IF v_updated_tenancy_count <> v_tenancy_count THEN
      RAISE EXCEPTION 'The current tenancy rent could not be verified';
    END IF;
  ELSE
    v_updated_tenancy_count := 0;
  END IF;

  SELECT room.*
  INTO v_room
  FROM public.rooms AS room
  WHERE room.room_id = p_room_id;

  RETURN jsonb_build_object(
    'room_id', v_room.room_id,
    'boarding_house_id', v_room.boarding_house_id,
    'room_name', v_room.room_name,
    'monthly_rate', v_room.monthly_rate,
    'last_updated_at', v_room.last_updated_at,
    'tenancy_count', v_tenancy_count,
    'tenancy_updated_count', v_updated_tenancy_count,
    'rate_mismatches', v_rate_mismatches
  );
END;
$$;


ALTER FUNCTION "public"."edit_room_with_rent_sync"("p_room_id" "uuid", "p_room_name" "text", "p_monthly_rate" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_explicit_bill_finalization"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."enforce_explicit_bill_finalization"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_tenant_bill"("p_bill_id" "uuid", "p_request_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_owner_id uuid := auth.uid(); v_bill public.monthly_bill%ROWTYPE; v_sum numeric; v_reminder_id uuid; v_email text; v_has_electricity boolean; v_payload jsonb;
BEGIN
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF p_bill_id IS NULL THEN RAISE EXCEPTION 'A bill is required'; END IF;
  IF p_request_id IS NULL OR length(btrim(p_request_id)) < 8 OR length(p_request_id) > 100 THEN RAISE EXCEPTION 'A valid delivery request identifier is required'; END IF;
  SELECT bill.* INTO v_bill FROM public.monthly_bill bill JOIN public.tenancy tenancy ON tenancy.tenancy_id = bill.tenancy_id WHERE bill.bill_id = p_bill_id AND tenancy.owner_id = v_owner_id FOR UPDATE OF bill;
  IF NOT FOUND THEN RAISE EXCEPTION 'Monthly bill not found or not authorized'; END IF;
  IF v_bill.billed_at IS NOT NULL OR coalesce(v_bill.is_paid, false) OR v_bill.paid_at IS NOT NULL THEN RAISE EXCEPTION 'This bill is already finalized or paid'; END IF;
  SELECT coalesce(sum(item.amount), 0) INTO v_sum FROM public.bill_items item WHERE item.bill_id = v_bill.bill_id;
  IF abs(coalesce(v_bill.total_amount, 0) - v_sum) > 0.005 THEN RAISE EXCEPTION 'The bill total does not match its itemized charges'; END IF;
  v_has_electricity := EXISTS (SELECT 1 FROM public.bill_items item WHERE item.bill_id = v_bill.bill_id AND (item.item_type = 'electricity' OR (item.item_type = 'adjustment' AND item.description IN ('Electricity', 'Electricity not charged'))));
  IF NOT v_has_electricity AND v_bill.electricity_roll_forward_to_bill_id IS NOT NULL THEN
    v_has_electricity := EXISTS (SELECT 1 FROM public.monthly_bill target_bill JOIN public.bill_items target_item ON target_item.bill_id = target_bill.bill_id AND target_item.item_type = 'electricity' JOIN public.meter_readings start_reading ON start_reading.reading_id = target_item.start_reading_id JOIN public.meter_readings end_reading ON end_reading.reading_id = target_item.end_reading_id WHERE target_bill.bill_id = v_bill.electricity_roll_forward_to_bill_id AND target_bill.tenancy_id = v_bill.tenancy_id AND target_bill.billed_at IS NOT NULL AND start_reading.reading_at <= v_bill.period_start AND end_reading.reading_at >= v_bill.period_end);
  END IF;
  IF NOT v_has_electricity THEN RAISE EXCEPTION 'Save an electricity reading before finalizing this bill'; END IF;
  PERFORM set_config('inkeeper.explicit_finalize_bill_id', v_bill.bill_id::text, true);
  UPDATE public.monthly_bill SET billed_at = now() WHERE bill_id = v_bill.bill_id;
  INSERT INTO public.bill_reminders (bill_id, reminder_type, reminder_day, delivery_status, attempt_count, attempt_started_at, client_request_id) VALUES (v_bill.bill_id, 'tenant_bill_sent'::public.reminder_type, NULL, 'pending', 1, now(), p_request_id) RETURNING reminder_id INTO v_reminder_id;
  v_payload := private.build_bill_email_payload(v_bill.bill_id); v_email := v_payload ->> 'tenantEmail';
  IF v_email IS NULL THEN
    UPDATE public.bill_reminders SET delivery_status = 'failed', retry_at = NULL, last_error = 'No email on file for this tenant.', sent_at = NULL WHERE reminder_id = v_reminder_id;
    RETURN jsonb_build_object('kind', 'no_email', 'reminderId', v_reminder_id, 'bill', v_payload);
  END IF;
  RETURN jsonb_build_object('kind', 'pending', 'reminderId', v_reminder_id, 'bill', v_payload);
END;
$$;


ALTER FUNCTION "public"."finalize_tenant_bill"("p_bill_id" "uuid", "p_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_last_updated"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  NEW.last_updated_at := now();
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."fn_last_updated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_sync_room_occupancy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$declare
  rid uuid;
begin
  for rid in
    select distinct x
    from unnest(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.room_id end,
      case when tg_op in ('INSERT', 'UPDATE') then new.room_id end
    ]) as x
    where x is not null
  loop
    update public.rooms r
    set is_occupied = exists (
      select 1
      from public.tenancy t
      where t.room_id = rid
        and t.status = 'active'
    )
    where r.room_id = rid;
  end loop;

  return null;
end;$$;


ALTER FUNCTION "public"."fn_sync_room_occupancy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_due_bills"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$declare
  today       date := (now() at time zone 'Asia/Manila')::date;
  -- due_in_days int  := 0;      -- days after period start that the bill is due
  r           record;
  ps          date;
  pe          date;
  n           int := 0;
begin
  for r in
    select tenancy_id, move_in_date
    from public.tenancy
    where status = 'active'
  loop
    -- current period = from the latest cycle date on or before today
    if public.cycle_date(r.move_in_date, today) <= today then
      ps := public.cycle_date(r.move_in_date, today);
      pe := public.cycle_date(r.move_in_date, (today + interval '1 month')::date) - 1;
    else
      ps := public.cycle_date(r.move_in_date, (today - interval '1 month')::date);
      pe := public.cycle_date(r.move_in_date, today) - 1;
    end if;

    if ps < r.move_in_date then ps := r.move_in_date; end if;

    -- already billed for this period?
    if exists (select 1 from public.monthly_bill b
               where b.tenancy_id = r.tenancy_id and b.period_start = ps) then
      continue;
    end if;

    begin
      perform public.generate_monthly_bill(r.tenancy_id, ps, pe, pe);
      -- legacy: perform public.generate_monthly_bill(r.tenancy_id, ps, pe, pe + due_in_days);
      n := n + 1;
    exception when others then
      -- one bad tenancy must not block everyone else's bill
      raise warning 'Bill generation failed for tenancy %: %', r.tenancy_id, sqlerrm;
    end;
  end loop;

  return n;
end;$$;


ALTER FUNCTION "public"."generate_due_bills"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_monthly_bill"("p_tenancy_id" "uuid", "p_period_start" "date", "p_period_end" "date", "p_due_date" "date") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bill_id uuid;
  v_room uuid;
  v_rent numeric;
BEGIN
  SELECT room_id, monthly_rate
  INTO v_room, v_rent
  FROM public.tenancy
  WHERE tenancy_id = p_tenancy_id
    AND status = 'active';

  IF v_room IS NULL THEN
    RAISE EXCEPTION 'No active tenancy found';
  END IF;

  INSERT INTO public.monthly_bill (tenancy_id, period_start, period_end, due_date)
  VALUES (p_tenancy_id, p_period_start, p_period_end, p_due_date)
  RETURNING bill_id INTO v_bill_id;

  INSERT INTO public.bill_items (bill_id, item_type, quantity, unit_price)
  VALUES (v_bill_id, 'rent', 1, v_rent);

  INSERT INTO public.bill_items (bill_id, item_type, quantity, unit_price)
  SELECT v_bill_id, charge.item_type, 1, charge.unit_price
  FROM (
    SELECT charge_type.item_type,
           coalesce(tenancy_charge.unit_price, owner_charge.unit_price) AS unit_price
    FROM (VALUES
      ('water'::public.bill_item_type),
      ('trash'::public.bill_item_type),
      ('wifi'::public.bill_item_type)
    ) AS charge_type(item_type)
    JOIN public.tenancy t ON t.tenancy_id = p_tenancy_id
    LEFT JOIN public.tenancy_default_charges tenancy_charge
      ON tenancy_charge.tenancy_id = t.tenancy_id
      AND tenancy_charge.item_type = charge_type.item_type
    LEFT JOIN public.owner_default_charges owner_charge
      ON owner_charge.owner_id = t.owner_id
      AND owner_charge.item_type = charge_type.item_type
  ) AS charge
  WHERE charge.unit_price IS NOT NULL;

  RETURN v_bill_id;
END;
$$;


ALTER FUNCTION "public"."generate_monthly_bill"("p_tenancy_id" "uuid", "p_period_start" "date", "p_period_end" "date", "p_due_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bill_electricity_context"("p_bill_id" "uuid", "p_reading_at" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bill public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
  v_rate numeric;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
BEGIN
  SELECT * INTO v_bill
  FROM public.monthly_bill
  WHERE bill_id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_bill.tenancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill tenancy not found or not authorized';
  END IF;

  SELECT coalesce(tc.unit_price, oc.unit_price)
  INTO v_rate
  FROM public.tenancy t
  LEFT JOIN public.tenancy_default_charges tc
    ON tc.tenancy_id = t.tenancy_id AND tc.item_type = 'electricity'
  LEFT JOIN public.owner_default_charges oc
    ON oc.owner_id = t.owner_id AND oc.item_type = 'electricity'
  WHERE t.tenancy_id = v_tenancy.tenancy_id;

  SELECT * INTO v_item
  FROM public.bill_items
  WHERE bill_id = p_bill_id
    AND item_type = 'electricity'
  ORDER BY bill_item_id
  LIMIT 1;

  IF v_item.bill_item_id IS NOT NULL THEN
    SELECT * INTO v_start FROM public.meter_readings
    WHERE reading_id = v_item.start_reading_id;
    SELECT * INTO v_end FROM public.meter_readings
    WHERE reading_id = v_item.end_reading_id;
  ELSIF p_reading_at IS NOT NULL THEN
    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at < p_reading_at
      AND reading_at >= v_tenancy.move_in_date
      AND (v_tenancy.move_out_date IS NULL OR reading_at <= v_tenancy.move_out_date)
    ORDER BY reading_at DESC, reading_id DESC
    LIMIT 1;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at = p_reading_at;
  END IF;

  RETURN jsonb_build_object(
    'periodStart', v_bill.period_start,
    'periodEnd', v_bill.period_end,
    'readingDateValid',
      p_reading_at IS NOT NULL
      AND p_reading_at BETWEEN v_bill.period_start AND v_bill.period_end
      AND p_reading_at <= (now() AT TIME ZONE 'Asia/Manila')::date
      AND p_reading_at >= v_tenancy.move_in_date
      AND (v_tenancy.move_out_date IS NULL OR p_reading_at <= v_tenancy.move_out_date),
    'rate', v_rate,
    'isLocked', v_bill.billed_at IS NOT NULL OR coalesce(v_bill.is_paid, false),
    'saved', v_item.bill_item_id IS NOT NULL,
    'previousReading', CASE WHEN v_start.reading_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_start.reading_id,
      'value', v_start.reading_value,
      'readingAt', v_start.reading_at
    ) END,
    'currentReading', CASE WHEN v_end.reading_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_end.reading_id,
      'value', v_end.reading_value,
      'readingAt', v_end.reading_at
    ) END,
    'usage', CASE WHEN v_item.bill_item_id IS NULL THEN NULL ELSE v_item.quantity END,
    'amount', CASE WHEN v_item.bill_item_id IS NULL THEN NULL ELSE v_item.amount END
  );
END;
$$;


ALTER FUNCTION "public"."get_bill_electricity_context"("p_bill_id" "uuid", "p_reading_at" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bill_meter_reading_correction_context"("p_bill_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bill public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_latest public.meter_readings%ROWTYPE;
  v_reason text;
  v_eligible boolean := false;
BEGIN
  SELECT * INTO v_bill
  FROM public.monthly_bill
  WHERE bill_id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_bill.tenancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill tenancy not found or not authorized';
  END IF;

  SELECT * INTO v_item
  FROM public.bill_items
  WHERE bill_id = v_bill.bill_id
    AND item_type = 'electricity'
  ORDER BY bill_item_id
  LIMIT 1;

  IF v_item.bill_item_id IS NOT NULL THEN
    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE reading_id = v_item.start_reading_id;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE reading_id = v_item.end_reading_id;
    IF v_end.reading_id IS NOT NULL AND v_end.room_id IS NOT NULL THEN
      SELECT * INTO v_latest
      FROM public.meter_readings
      WHERE room_id = v_end.room_id
      ORDER BY reading_at DESC, reading_id DESC
      LIMIT 1;
    END IF;
  END IF;

  v_reason := CASE
    WHEN v_bill.billed_at IS NOT NULL
      THEN 'This bill is finalized and can no longer be changed.'
    WHEN coalesce(v_bill.is_paid, false) OR v_bill.paid_at IS NOT NULL
      THEN 'This bill is paid, so the reading cannot be changed.'
    WHEN v_bill.electricity_roll_forward_to_bill_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.monthly_bill AS source
        WHERE source.electricity_roll_forward_to_bill_id = v_bill.bill_id
      )
      THEN 'This reading is part of a carry-forward and cannot be changed.'
    WHEN v_tenancy.status <> 'active'
      OR EXISTS (
        SELECT 1
        FROM public.tenant_archive AS archive
        WHERE archive.tenancy_id = v_tenancy.tenancy_id
      )
      THEN 'Only an active tenant''s bill reading can be corrected.'
    WHEN v_item.bill_item_id IS NULL
      OR v_end.reading_id IS NULL
      THEN 'There is no saved meter reading on this bill.'
    WHEN v_latest.reading_id IS DISTINCT FROM v_end.reading_id
      THEN 'A later reading exists. Only the latest reading can be corrected.'
    WHEN v_end.reading_at = v_tenancy.move_in_date
      THEN 'The tenant''s move-in reading cannot be changed.'
    WHEN NOT EXISTS (
      SELECT 1
      FROM public.meter_readings AS earlier
      WHERE earlier.room_id = v_end.room_id
        AND earlier.reading_at < v_end.reading_at
    )
      THEN 'The initial meter reading cannot be changed.'
    WHEN v_start.reading_id IS NULL
      THEN 'A previous meter reading is required before this bill can be corrected.'
    WHEN EXISTS (
      SELECT 1
      FROM public.meter_readings AS expected
      WHERE expected.room_id = v_end.room_id
        AND expected.reading_at < v_end.reading_at
        AND expected.reading_at >= v_tenancy.move_in_date
        AND expected.reading_id <> v_start.reading_id
        AND expected.reading_at > v_start.reading_at
    )
      THEN 'A different previous reading exists, so this bill cannot be corrected.'
    ELSE NULL
  END;
  v_eligible := v_reason IS NULL;

  RETURN jsonb_build_object(
    'billId', v_bill.bill_id,
    'eligible', v_eligible,
    'reason', v_reason,
    'readingId', CASE WHEN v_end.reading_id IS NULL THEN NULL ELSE v_end.reading_id END,
    'readingAt', CASE WHEN v_end.reading_id IS NULL THEN NULL ELSE v_end.reading_at END,
    'oldValue', CASE WHEN v_end.reading_id IS NULL THEN NULL ELSE v_end.reading_value END,
    'previousValue', CASE WHEN v_start.reading_id IS NULL THEN NULL ELSE v_start.reading_value END,
    'usage', CASE WHEN v_item.bill_item_id IS NULL THEN NULL ELSE v_item.quantity END,
    'rate', CASE WHEN v_item.bill_item_id IS NULL THEN NULL ELSE v_item.unit_price END,
    'electricityCharge', CASE WHEN v_item.bill_item_id IS NULL THEN NULL ELSE v_item.amount END,
    'totalAmount', v_bill.total_amount
  );
END;
$$;


ALTER FUNCTION "public"."get_bill_meter_reading_correction_context"("p_bill_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_tenant_list"("p_tab" "text", "p_search" "text" DEFAULT NULL::"text") RETURNS TABLE("tenant_id" "uuid", "tenancy_id" "uuid", "archive_id" "uuid", "tenant_name" "text", "room_name" "text", "move_in_date" "date", "move_out_date" "date", "status" "text", "archived_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE
  v_tab text := lower(btrim(p_tab));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_owner_id uuid := auth.uid();
BEGIN
  IF v_tab IS NULL OR v_tab NOT IN ('active', 'scheduled', 'archived') THEN
    RAISE EXCEPTION 'Invalid tenant tab: %. Expected active, scheduled, or archived.', p_tab
      USING ERRCODE = '22023';
  END IF;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated owner is required to list tenants.'
      USING ERRCODE = '42501';
  END IF;

  IF v_tab = 'archived' THEN
    RETURN QUERY
    SELECT
      a.tenant_id,
      a.tenancy_id,
      a.archive_id,
      a.tenant_name,
      a.room_name::text,
      a.move_in_date,
      a.move_out_date,
      NULL::text,
      a.archived_at
    FROM public.tenant_archive AS a
    WHERE a.owner_id = v_owner_id
      AND (
        v_search IS NULL
        OR strpos(lower(a.tenant_name), lower(v_search)) > 0
        OR strpos(lower(coalesce(a.room_name, '')), lower(v_search)) > 0
      )
    ORDER BY a.move_in_date NULLS LAST, a.archive_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ty.tenant_id,
    ty.tenancy_id,
    NULL::uuid,
    t.name::text,
    r.room_name::text,
    ty.move_in_date,
    ty.move_out_date,
    ty.status::text,
    NULL::timestamptz
  FROM public.tenancy AS ty
  JOIN public.tenants AS t ON t.tenant_id = ty.tenant_id
  JOIN public.rooms AS r ON r.room_id = ty.room_id
  WHERE ty.owner_id = v_owner_id
    AND t.owner_id = v_owner_id
    AND ty.status = v_tab
    AND (
      v_search IS NULL
      OR strpos(lower(t.name), lower(v_search)) > 0
      OR strpos(lower(r.room_name), lower(v_search)) > 0
    )
  ORDER BY ty.move_in_date NULLS LAST, ty.tenancy_id;
END;
$$;


ALTER FUNCTION "public"."get_tenant_list"("p_tab" "text", "p_search" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_electricity_roll_forward"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_room_id uuid;
  v_tenancy public.tenancy%ROWTYPE;
  v_target public.monthly_bill%ROWTYPE;
  v_target_item public.bill_items%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_source public.monthly_bill%ROWTYPE;
BEGIN
  IF new.electricity_roll_forward_to_bill_id
       IS DISTINCT FROM old.electricity_roll_forward_to_bill_id THEN
    IF old.billed_at IS NOT NULL
       OR coalesce(old.is_paid, false)
       OR old.paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'A finalized or paid bill cannot change its carry-forward';
    END IF;

    IF old.electricity_roll_forward_to_bill_id IS NOT NULL
       AND new.electricity_roll_forward_to_bill_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cancel the existing carry-forward before selecting another bill';
    END IF;

    IF new.electricity_roll_forward_to_bill_id IS NULL THEN
      SELECT * INTO v_target
      FROM public.monthly_bill
      WHERE bill_id = old.electricity_roll_forward_to_bill_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The carry-forward bill could not be found';
      END IF;

      IF v_target.billed_at IS NOT NULL
         OR coalesce(v_target.is_paid, false)
         OR v_target.paid_at IS NOT NULL
         OR EXISTS (
           SELECT 1
           FROM public.bill_items
           WHERE bill_id = v_target.bill_id
             AND item_type = 'electricity'
         )
         OR EXISTS (
           SELECT 1
           FROM public.meter_readings
           WHERE room_id = (
             SELECT room_id
             FROM public.tenancy
             WHERE tenancy_id = old.tenancy_id
           )
             AND reading_at > old.period_end
         ) THEN
        RAISE EXCEPTION 'A later reading already exists; this carry-forward cannot be cancelled safely';
      END IF;
    ELSE
      SELECT * INTO v_target
      FROM public.monthly_bill
      WHERE bill_id = new.electricity_roll_forward_to_bill_id
        AND tenancy_id = new.tenancy_id;
      IF NOT FOUND OR v_target.period_start <= new.period_end THEN
        RAISE EXCEPTION 'Carry-forward target must be a later bill for the same tenancy';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.bill_items
        WHERE bill_id = new.bill_id
          AND (
            item_type = 'electricity'
            OR (item_type = 'adjustment' AND description = 'Electricity')
          )
      ) THEN
        RAISE EXCEPTION 'A bill with an electricity charge cannot be carried forward';
      END IF;

      SELECT * INTO v_target_item
      FROM public.bill_items
      WHERE bill_id = v_target.bill_id
        AND item_type = 'electricity'
      ORDER BY bill_item_id
      LIMIT 1;

      IF v_target_item.bill_item_id IS NOT NULL THEN
        SELECT * INTO v_start
        FROM public.meter_readings
        WHERE reading_id = v_target_item.start_reading_id;
        SELECT * INTO v_end
        FROM public.meter_readings
        WHERE reading_id = v_target_item.end_reading_id;
        IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL
           OR v_start.reading_at > new.period_start
           OR v_end.reading_at < new.period_end THEN
          RAISE EXCEPTION 'The later bill reading interval does not cover this bill period';
        END IF;
        new.billed_at := now();
      ELSE
        IF EXISTS (
          SELECT 1
          FROM public.bill_items
          WHERE bill_id = v_target.bill_id
            AND item_type = 'adjustment'
            AND description = 'Electricity'
        ) THEN
          RAISE EXCEPTION 'The later bill already has a manual electricity charge';
        END IF;
        IF v_target.billed_at IS NOT NULL
           OR coalesce(v_target.is_paid, false)
           OR v_target.paid_at IS NOT NULL THEN
          RAISE EXCEPTION 'The later bill is finalized but does not contain this missed-period usage';
        END IF;

        SELECT * INTO v_tenancy
        FROM public.tenancy
        WHERE tenancy_id = new.tenancy_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Bill tenancy not found or not authorized';
        END IF;
        v_room_id := v_tenancy.room_id;

        IF NOT EXISTS (
          SELECT 1
          FROM public.meter_readings
          WHERE room_id = v_room_id
            AND reading_at >= v_tenancy.move_in_date
            AND reading_at <= new.period_start
        ) THEN
          RAISE EXCEPTION 'An opening meter reading before this bill period is required for carry-forward';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM public.meter_readings
          WHERE room_id = v_room_id
            AND reading_at > new.period_start
            AND reading_at <= new.period_end
        ) THEN
          RAISE EXCEPTION 'A reading already exists in this bill period. Use late reading instead';
        END IF;
      END IF;
    END IF;
  END IF;

  IF (new.paid_at IS NOT NULL OR coalesce(new.is_paid, false))
     AND new.billed_at IS NULL
     AND (
       new.electricity_roll_forward_to_bill_id IS NOT NULL
       OR old.electricity_roll_forward_to_bill_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'This bill cannot be marked paid until its carry-forward is completed';
  END IF;

  IF old.billed_at IS NOT NULL OR new.billed_at IS NULL THEN
    RETURN new;
  END IF;

  IF new.electricity_roll_forward_to_bill_id IS NOT NULL THEN
    SELECT * INTO v_target
    FROM public.monthly_bill
    WHERE bill_id = new.electricity_roll_forward_to_bill_id
      AND tenancy_id = new.tenancy_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Carry-forward target must belong to the same tenancy';
    END IF;

    SELECT * INTO v_target_item
    FROM public.bill_items
    WHERE bill_id = v_target.bill_id
      AND item_type = 'electricity'
    ORDER BY bill_item_id
    LIMIT 1;
    IF v_target_item.bill_item_id IS NULL THEN
      RAISE EXCEPTION 'The later bill must contain the rolled-forward electricity charge before this bill is issued';
    END IF;

    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE reading_id = v_target_item.start_reading_id;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE reading_id = v_target_item.end_reading_id;
    IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL
       OR v_start.reading_at > new.period_start
       OR v_end.reading_at < new.period_end THEN
      RAISE EXCEPTION 'The later bill reading interval does not cover this bill period';
    END IF;
    RETURN new;
  END IF;

  SELECT room_id INTO v_room_id
  FROM public.tenancy
  WHERE tenancy_id = new.tenancy_id;

  IF EXISTS (
    SELECT 1
    FROM public.monthly_bill older
    WHERE older.tenancy_id = new.tenancy_id
      AND older.period_end < new.period_start
      AND older.billed_at IS NULL
      AND NOT coalesce(older.is_paid, false)
      AND older.paid_at IS NULL
      AND older.electricity_roll_forward_to_bill_id IS DISTINCT FROM new.bill_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.bill_items older_item
        WHERE older_item.bill_id = older.bill_id
          AND (
            older_item.item_type = 'electricity'
            OR (
              older_item.item_type = 'adjustment'
              AND older_item.description = 'Electricity'
            )
          )
      )
      AND EXISTS (
        SELECT 1
        FROM public.meter_readings
        WHERE room_id = v_room_id
      )
  ) THEN
    RAISE EXCEPTION 'Resolve earlier electricity readings with a late reading or explicit carry-forward before issuing this bill';
  END IF;

  FOR v_source IN
    SELECT *
    FROM public.monthly_bill
    WHERE electricity_roll_forward_to_bill_id = new.bill_id
      AND billed_at IS NULL
      AND NOT coalesce(is_paid, false)
      AND paid_at IS NULL
    ORDER BY period_start
    FOR UPDATE
  LOOP
    SELECT * INTO v_target_item
    FROM public.bill_items
    WHERE bill_id = new.bill_id
      AND item_type = 'electricity'
    ORDER BY bill_item_id
    LIMIT 1;
    IF v_target_item.bill_item_id IS NULL THEN
      RAISE EXCEPTION 'The later bill must contain the rolled-forward electricity charge before the earlier bill is issued';
    END IF;

    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE reading_id = v_target_item.start_reading_id;
    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE reading_id = v_target_item.end_reading_id;
    IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL
       OR v_start.reading_at > v_source.period_start
       OR v_end.reading_at < v_source.period_end THEN
      RAISE EXCEPTION 'The later bill reading interval does not cover a carried-forward period';
    END IF;

    UPDATE public.monthly_bill
    SET billed_at = new.billed_at
    WHERE bill_id = v_source.bill_id;
  END LOOP;

  RETURN new;
END;
$$;


ALTER FUNCTION "public"."guard_electricity_roll_forward"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_final_move_out_no_charge"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND old.item_type = 'adjustment' AND old.description = 'Electricity not charged' THEN
    RAISE EXCEPTION 'The no-electricity-charge exception cannot be changed or removed';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND new.item_type = 'electricity' AND EXISTS (SELECT 1 FROM public.bill_items AS item WHERE item.bill_id = new.bill_id AND item.bill_item_id IS DISTINCT FROM new.bill_item_id AND item.item_type = 'adjustment' AND item.description = 'Electricity not charged') THEN
    RAISE EXCEPTION 'Electricity was not charged on this final bill. This exception cannot be undone.';
  END IF;
  RETURN coalesce(new, old);
END;
$$;


ALTER FUNCTION "public"."guard_final_move_out_no_charge"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.owner_profile (id, full_name, phone_number, email_address)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone_number',
    new.email
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preview_tenant_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text" DEFAULT NULL::"text", "p_reading_value" numeric DEFAULT NULL::numeric, "p_reading_at" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_owner_id uuid := auth.uid(); v_tenancy public.tenancy%ROWTYPE; v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_last_reading public.meter_readings%ROWTYPE; v_last_payment_date date; v_last_finalized_end date; v_earliest date;
  v_final_bill public.monthly_bill%ROWTYPE; v_existing_reading public.meter_readings%ROWTYPE; v_previous_reading public.meter_readings%ROWTYPE;
  v_next_tenancy public.tenancy%ROWTYPE; v_next_reading public.meter_readings%ROWTYPE; v_item public.bill_items%ROWTYPE;
  v_period_start date; v_base_total numeric; v_rate numeric; v_units numeric := 0; v_electricity numeric := 0;
  v_later_blocker record; v_later_count integer; v_zero_span boolean := false;
BEGIN
  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  SELECT tenancy.* INTO v_tenancy FROM public.tenancy AS tenancy WHERE tenancy.tenancy_id = p_tenancy_id AND tenancy.owner_id = v_owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenancy not found or not authorized'; END IF;
  IF v_tenancy.status <> 'active' OR v_tenancy.move_out_date IS NOT NULL THEN RAISE EXCEPTION 'Only a current tenant can be archived'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_archive AS archive WHERE archive.tenancy_id = v_tenancy.tenancy_id) THEN RAISE EXCEPTION 'This tenancy is already archived'; END IF;
  SELECT * INTO v_last_reading FROM public.meter_readings WHERE room_id = v_tenancy.room_id ORDER BY reading_at DESC, reading_id DESC LIMIT 1;
  SELECT max((bill.paid_at AT TIME ZONE 'Asia/Manila')::date) INTO v_last_payment_date FROM public.monthly_bill AS bill WHERE bill.tenancy_id = v_tenancy.tenancy_id AND bill.paid_at IS NOT NULL;
  SELECT max(bill.period_end) INTO v_last_finalized_end FROM public.monthly_bill AS bill WHERE bill.tenancy_id = v_tenancy.tenancy_id AND bill.billed_at IS NOT NULL;
  v_earliest := GREATEST(v_tenancy.move_in_date, coalesce(v_last_reading.reading_at, v_tenancy.move_in_date), coalesce(v_last_payment_date, v_tenancy.move_in_date), coalesce(v_last_finalized_end, v_tenancy.move_in_date));
  IF p_move_out_date IS NULL THEN RAISE EXCEPTION 'Choose a move-out date'; END IF;
  IF p_move_out_date > v_today THEN RAISE EXCEPTION 'The move-out date cannot be in the future'; END IF;
  IF p_move_out_date < v_earliest THEN RAISE EXCEPTION 'The move-out date cannot be before %', v_earliest; END IF;
  SELECT later.bill_id, later.period_start INTO v_later_blocker FROM public.monthly_bill AS later WHERE later.tenancy_id = v_tenancy.tenancy_id AND later.period_start > p_move_out_date AND (
    later.billed_at IS NOT NULL OR later.paid_at IS NOT NULL OR coalesce(later.is_paid, false) OR later.electricity_roll_forward_to_bill_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.monthly_bill AS carried WHERE carried.electricity_roll_forward_to_bill_id = later.bill_id)
    OR EXISTS (SELECT 1 FROM public.bill_items AS item WHERE item.bill_id = later.bill_id AND (item.end_reading_id IS NOT NULL OR (item.item_type = 'adjustment' AND item.description = 'Electricity not charged')))
    OR EXISTS (SELECT 1 FROM public.meter_readings AS reading WHERE reading.room_id = v_tenancy.room_id AND reading.reading_at BETWEEN later.period_start AND later.period_end)
  ) ORDER BY later.period_start LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'A bill starting % cannot be removed because it is finalized, paid, has a meter reading, or is in a carry-forward chain. Resolve it before archiving.', v_later_blocker.period_start; END IF;
  SELECT count(*) INTO v_later_count FROM public.monthly_bill WHERE tenancy_id = v_tenancy.tenancy_id AND period_start > p_move_out_date;
  SELECT * INTO v_final_bill FROM public.monthly_bill WHERE tenancy_id = v_tenancy.tenancy_id AND period_start <= p_move_out_date ORDER BY period_start DESC LIMIT 1;
  IF FOUND THEN
    IF v_final_bill.billed_at IS NOT NULL OR v_final_bill.paid_at IS NOT NULL OR coalesce(v_final_bill.is_paid, false) THEN RAISE EXCEPTION 'The final bill is already finalized or paid and cannot be changed'; END IF;
    IF v_final_bill.electricity_roll_forward_to_bill_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.monthly_bill AS carried WHERE carried.electricity_roll_forward_to_bill_id = v_final_bill.bill_id) THEN RAISE EXCEPTION 'The final bill is in a carry-forward chain. Resolve it before archiving.'; END IF;
    v_period_start := v_final_bill.period_start;
    SELECT coalesce(sum(item.amount), 0) INTO v_base_total FROM public.bill_items AS item WHERE item.bill_id = v_final_bill.bill_id AND item.item_type <> 'electricity' AND NOT (item.item_type = 'adjustment' AND item.description IN ('Electricity', 'Electricity not charged'));
  ELSE
    v_period_start := public.cycle_date(v_tenancy.move_in_date, p_move_out_date);
    IF v_period_start > p_move_out_date THEN v_period_start := public.cycle_date(v_tenancy.move_in_date, (p_move_out_date - interval '1 month')::date); END IF;
    v_period_start := GREATEST(v_period_start, v_tenancy.move_in_date);
    SELECT v_tenancy.monthly_rate + coalesce(sum(charge.unit_price), 0) INTO v_base_total FROM (
      SELECT coalesce(tenancy_charge.unit_price, room_charge.unit_price, owner_charge.unit_price) AS unit_price
      FROM (VALUES ('water'::public.bill_item_type), ('trash'::public.bill_item_type), ('wifi'::public.bill_item_type)) AS charge_type(item_type)
      LEFT JOIN public.tenancy_default_charges AS tenancy_charge ON tenancy_charge.tenancy_id = v_tenancy.tenancy_id AND tenancy_charge.item_type = charge_type.item_type
      LEFT JOIN public.room_default_charges AS room_charge ON room_charge.room_id = v_tenancy.room_id AND room_charge.item_type = charge_type.item_type
      LEFT JOIN public.owner_default_charges AS owner_charge ON owner_charge.owner_id = v_tenancy.owner_id AND owner_charge.item_type = charge_type.item_type
      WHERE coalesce(tenancy_charge.unit_price, room_charge.unit_price, owner_charge.unit_price) IS NOT NULL
    ) AS charge;
  END IF;
  SELECT * INTO v_item FROM public.bill_items WHERE bill_id = v_final_bill.bill_id AND item_type = 'electricity' ORDER BY bill_item_id LIMIT 1;
  IF p_electricity_option IS NULL THEN
    RETURN jsonb_build_object('today', v_today, 'earliestMoveOutDate', v_earliest, 'moveOutDate', p_move_out_date, 'billId', CASE WHEN v_final_bill.bill_id IS NULL THEN NULL ELSE v_final_bill.bill_id END, 'periodStart', v_period_start, 'periodEnd', p_move_out_date, 'dueDate', p_move_out_date, 'baseTotal', coalesce(v_base_total, 0), 'laterBillsToDelete', v_later_count, 'requiresElectricityChoice', true, 'previousReading', CASE WHEN v_last_reading.reading_id IS NULL THEN NULL ELSE jsonb_build_object('value', v_last_reading.reading_value, 'readingAt', v_last_reading.reading_at) END);
  END IF;
  IF p_electricity_option IS NULL OR p_electricity_option NOT IN ('reading', 'no_charge') THEN RAISE EXCEPTION 'Choose Enter final meter reading or No electricity charge for this bill'; END IF;
  IF p_electricity_option = 'no_charge' THEN
    IF v_item.bill_item_id IS NOT NULL THEN RAISE EXCEPTION 'The final bill already has an electricity reading'; END IF;
    IF v_final_bill.bill_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.bill_items AS item WHERE item.bill_id = v_final_bill.bill_id AND item.item_type = 'adjustment' AND item.description = 'Electricity') THEN RAISE EXCEPTION 'The final bill already has an electricity charge'; END IF;
  ELSE
    IF p_reading_value IS NULL OR p_reading_value < 0 OR p_reading_value >= 'Infinity'::numeric OR p_reading_value = 'NaN'::numeric THEN RAISE EXCEPTION 'Enter a valid nonnegative final meter reading'; END IF;
    IF p_reading_at IS NULL OR p_reading_at < p_move_out_date OR p_reading_at > v_today THEN RAISE EXCEPTION 'Choose a reading date from the move-out date through today'; END IF;
    IF v_last_reading.reading_id IS NOT NULL AND p_reading_value < v_last_reading.reading_value THEN RAISE EXCEPTION 'The final reading cannot be lower than the last saved reading'; END IF;
    SELECT * INTO v_existing_reading FROM public.meter_readings WHERE room_id = v_tenancy.room_id AND reading_at = p_reading_at LIMIT 1;
    IF FOUND AND v_existing_reading.reading_value <> p_reading_value THEN RAISE EXCEPTION 'A different meter reading is already saved for the final reading date'; END IF;
    IF v_existing_reading.reading_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.bill_items AS item WHERE item.end_reading_id = v_existing_reading.reading_id AND item.bill_id IS DISTINCT FROM v_final_bill.bill_id) THEN RAISE EXCEPTION 'This meter reading is already attached to another bill'; END IF;
    SELECT * INTO v_next_tenancy FROM public.tenancy WHERE room_id = v_tenancy.room_id AND tenancy_id <> v_tenancy.tenancy_id AND move_in_date > v_tenancy.move_in_date ORDER BY move_in_date, tenancy_id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_next_reading FROM public.meter_readings WHERE room_id = v_tenancy.room_id AND reading_at = v_next_tenancy.move_in_date LIMIT 1;
      IF FOUND THEN
        IF p_reading_value > v_next_reading.reading_value THEN RAISE EXCEPTION 'The final reading cannot be higher than the next tenant''s move-in reading'; END IF;
        IF p_reading_at = v_next_tenancy.move_in_date AND p_reading_value <> v_next_reading.reading_value THEN RAISE EXCEPTION 'The final reading must match the next tenant''s move-in reading'; END IF;
      END IF;
    END IF;
    SELECT * INTO v_previous_reading FROM public.meter_readings WHERE room_id = v_tenancy.room_id AND reading_at < p_reading_at AND reading_at >= v_tenancy.move_in_date ORDER BY reading_at DESC, reading_id DESC LIMIT 1;
    IF v_previous_reading.reading_id IS NULL AND v_existing_reading.reading_id IS NOT NULL AND v_existing_reading.reading_at = v_tenancy.move_in_date THEN v_previous_reading := v_existing_reading; v_zero_span := true;
    ELSIF v_previous_reading.reading_id IS NULL THEN RAISE EXCEPTION 'An opening meter reading for this tenancy is required before billing'; END IF;
    SELECT coalesce(tenancy_charge.unit_price, owner_charge.unit_price) INTO v_rate FROM public.tenancy AS tenancy LEFT JOIN public.tenancy_default_charges AS tenancy_charge ON tenancy_charge.tenancy_id = tenancy.tenancy_id AND tenancy_charge.item_type = 'electricity' LEFT JOIN public.owner_default_charges AS owner_charge ON owner_charge.owner_id = tenancy.owner_id AND owner_charge.item_type = 'electricity' WHERE tenancy.tenancy_id = v_tenancy.tenancy_id;
    IF v_rate IS NULL THEN RAISE EXCEPTION 'Set an electricity rate for this tenancy or owner before billing'; END IF;
    v_units := p_reading_value - v_previous_reading.reading_value; v_electricity := v_units * v_rate;
    IF v_item.bill_item_id IS NOT NULL THEN
      IF v_item.end_reading_id IS DISTINCT FROM v_existing_reading.reading_id OR v_existing_reading.reading_value <> p_reading_value THEN RAISE EXCEPTION 'The final bill already has a different electricity reading'; END IF;
      v_units := v_item.quantity; v_rate := v_item.unit_price; v_electricity := v_item.amount;
    END IF;
    IF v_final_bill.bill_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.bill_items AS item WHERE item.bill_id = v_final_bill.bill_id AND item.item_type = 'adjustment' AND item.description = 'Electricity' AND v_item.bill_item_id IS NULL) THEN RAISE EXCEPTION 'The final bill already has an electricity charge'; END IF;
    IF v_final_bill.bill_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.bill_items AS item WHERE item.bill_id = v_final_bill.bill_id AND item.item_type = 'adjustment' AND item.description = 'Electricity not charged') THEN RAISE EXCEPTION 'Electricity was not charged on this final bill. This exception cannot be undone.'; END IF;
  END IF;
  RETURN jsonb_build_object('today', v_today, 'earliestMoveOutDate', v_earliest, 'moveOutDate', p_move_out_date, 'billId', CASE WHEN v_final_bill.bill_id IS NULL THEN NULL ELSE v_final_bill.bill_id END, 'periodStart', v_period_start, 'periodEnd', p_move_out_date, 'dueDate', p_move_out_date, 'baseTotal', coalesce(v_base_total, 0), 'laterBillsToDelete', v_later_count, 'electricityOption', p_electricity_option, 'readingValue', CASE WHEN p_electricity_option = 'reading' THEN p_reading_value END, 'readingAt', CASE WHEN p_electricity_option = 'reading' THEN p_reading_at END, 'previousReading', CASE WHEN v_previous_reading.reading_id IS NULL THEN NULL ELSE jsonb_build_object('value', v_previous_reading.reading_value, 'readingAt', v_previous_reading.reading_at) END, 'units', CASE WHEN p_electricity_option = 'reading' THEN v_units END, 'rate', CASE WHEN p_electricity_option = 'reading' THEN v_rate END, 'electricityCharge', CASE WHEN p_electricity_option = 'reading' THEN v_electricity ELSE 0 END, 'total', coalesce(v_base_total, 0) + CASE WHEN p_electricity_option = 'reading' THEN v_electricity ELSE 0 END, 'noElectricityCharge', p_electricity_option = 'no_charge', 'zeroSpan', v_zero_span);
END;
$$;


ALTER FUNCTION "public"."preview_tenant_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text", "p_reading_value" numeric, "p_reading_at" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_bill_total"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_bill_id uuid := coalesce(new.bill_id, old.bill_id);
BEGIN
  UPDATE public.monthly_bill
  SET
    total_amount = coalesce(
      (
        SELECT sum(item.amount)
        FROM public.bill_items AS item
        WHERE item.bill_id = v_bill_id
      ),
      0
    ),
    updated_at = now()
  WHERE bill_id = v_bill_id;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."recalc_bill_total"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_bill_electricity_reading"("p_bill_id" "uuid", "p_reading_value" numeric, "p_reading_at" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_bill public.monthly_bill%ROWTYPE;
  v_tenancy public.tenancy%ROWTYPE;
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_item public.bill_items%ROWTYPE;
  v_rate numeric;
  v_usage numeric;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_is_new_reading boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_reading_value IS NULL
     OR p_reading_value < 0
     OR p_reading_value >= 'Infinity'::numeric
     OR p_reading_value = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Enter a valid nonnegative meter reading';
  END IF;

  IF p_reading_at IS NULL OR p_reading_at > v_today THEN
    RAISE EXCEPTION 'The meter reading date cannot be in the future';
  END IF;

  SELECT * INTO v_bill
  FROM public.monthly_bill
  WHERE bill_id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly bill not found or not authorized';
  END IF;
  IF v_bill.billed_at IS NOT NULL OR coalesce(v_bill.is_paid, false) THEN
    RAISE EXCEPTION 'This bill is finalized and can no longer be changed';
  END IF;
  IF p_reading_at < v_bill.period_start OR p_reading_at > v_bill.period_end THEN
    RAISE EXCEPTION 'The reading date must fall within this bill period';
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = v_bill.tenancy_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill tenancy not found or not authorized';
  END IF;
  IF p_reading_at < v_tenancy.move_in_date
     OR (v_tenancy.move_out_date IS NOT NULL
         AND p_reading_at > v_tenancy.move_out_date) THEN
    RAISE EXCEPTION 'The reading date must fall within this tenancy';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('meter:' || v_tenancy.room_id::text, 0)
  );

  SELECT * INTO v_item
  FROM public.bill_items
  WHERE bill_id = p_bill_id
    AND item_type = 'electricity'
  ORDER BY bill_item_id
  LIMIT 1;

  IF v_item.bill_item_id IS NOT NULL THEN
    IF v_item.end_reading_id IN (
      SELECT reading_id
      FROM public.meter_readings
      WHERE room_id = v_tenancy.room_id
        AND reading_at = p_reading_at
        AND reading_value = p_reading_value
    ) THEN
      SELECT * INTO v_start FROM public.meter_readings
      WHERE reading_id = v_item.start_reading_id;
      SELECT * INTO v_end FROM public.meter_readings
      WHERE reading_id = v_item.end_reading_id;
    ELSE
      RAISE EXCEPTION 'An electricity reading is already saved on this bill';
    END IF;
  ELSE
    SELECT coalesce(tc.unit_price, oc.unit_price)
    INTO v_rate
    FROM public.tenancy t
    LEFT JOIN public.tenancy_default_charges tc
      ON tc.tenancy_id = t.tenancy_id AND tc.item_type = 'electricity'
    LEFT JOIN public.owner_default_charges oc
      ON oc.owner_id = t.owner_id AND oc.item_type = 'electricity'
    WHERE t.tenancy_id = v_tenancy.tenancy_id;

    IF v_rate IS NULL THEN
      RAISE EXCEPTION 'Set an electricity rate for this tenancy or owner before billing';
    END IF;

    SELECT * INTO v_start
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at < p_reading_at
      AND reading_at >= v_tenancy.move_in_date
      AND (v_tenancy.move_out_date IS NULL OR reading_at <= v_tenancy.move_out_date)
    ORDER BY reading_at DESC, reading_id DESC
    LIMIT 1;

    IF v_start.reading_id IS NULL THEN
      RAISE EXCEPTION 'An opening meter reading for this tenancy is required before billing';
    END IF;

    SELECT * INTO v_end
    FROM public.meter_readings
    WHERE room_id = v_tenancy.room_id
      AND reading_at = p_reading_at
    FOR UPDATE;

    IF FOUND THEN
      IF v_end.reading_value <> p_reading_value THEN
        RAISE EXCEPTION 'A different meter reading is already saved for this date';
      END IF;
    ELSE
      INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
      VALUES (v_tenancy.room_id, p_reading_value, p_reading_at)
      RETURNING * INTO v_end;
      v_is_new_reading := true;
    END IF;

    IF v_end.reading_at <= v_start.reading_at
       OR v_end.reading_value < v_start.reading_value THEN
      RAISE EXCEPTION 'The current reading must be later and no lower than the previous reading';
    END IF;
    v_usage := v_end.reading_value - v_start.reading_value;

    IF EXISTS (
      SELECT 1
      FROM public.bill_items other_item
      WHERE other_item.item_type = 'electricity'
        AND other_item.end_reading_id = v_end.reading_id
    ) THEN
      RAISE EXCEPTION 'This meter reading is already attached to another bill';
    END IF;

    INSERT INTO public.bill_items (
      bill_id, item_type, quantity, unit_price, start_reading_id, end_reading_id
    )
    VALUES (
      p_bill_id,
      'electricity',
      v_usage,
      v_rate,
      v_start.reading_id,
      v_end.reading_id
    )
    RETURNING * INTO v_item;
  END IF;

  IF v_bill.billed_at IS NULL THEN
    UPDATE public.monthly_bill
    SET billed_at = now()
    WHERE bill_id = p_bill_id
      AND billed_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'saved', true,
    'electricityBilled', v_item.bill_item_id IS NOT NULL,
    'createdReading', v_is_new_reading,
    'previousReading', jsonb_build_object(
      'id', v_start.reading_id,
      'value', v_start.reading_value,
      'readingAt', v_start.reading_at
    ),
    'currentReading', jsonb_build_object(
      'id', v_end.reading_id,
      'value', v_end.reading_value,
      'readingAt', v_end.reading_at
    ),
    'usage', coalesce(v_item.quantity, v_usage),
    'rate', v_item.unit_price,
    'amount', v_item.amount
  );
END;
$$;


ALTER FUNCTION "public"."record_bill_electricity_reading"("p_bill_id" "uuid", "p_reading_value" numeric, "p_reading_at" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_tenancy_statuses"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
begin
  -- 1) End first, so a room is freed before the next tenant is activated
  update public.tenancy
  set status = 'ended', last_updated_at = now()
  where status = 'active'
    and move_out_date is not null
    and move_out_date <= today;

  -- 2) Then activate tenancies whose move-in day has arrived
  update public.tenancy
  set status = 'active', last_updated_at = now()
  where status = 'scheduled'
    and move_in_date <= today
    and (move_out_date is null or move_out_date > today);

  -- 3) Scheduled tenancies that were already over (missed days) become ended
  update public.tenancy
  set status = 'ended', last_updated_at = now()
  where status = 'scheduled'
    and move_out_date is not null
    and move_out_date <= today;
end;
$$;


ALTER FUNCTION "public"."refresh_tenancy_statuses"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_tenancy"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_owner_id uuid := auth.uid();
  v_tenant_id uuid;
  v_tenancy_id uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_period_start date;
  v_period_end date;
  v_charge record;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = ''
     OR p_id_photo_url IS NULL OR p_agreement_photo_url IS NULL
     OR p_move_in_date IS NULL THEN
    RAISE EXCEPTION 'Tenant name, documents, and move-in date are required';
  END IF;

  IF array_length(string_to_array(p_id_photo_url, '/'), 1) <> 5
     OR array_length(string_to_array(p_agreement_photo_url, '/'), 1) <> 5
     OR split_part(p_id_photo_url, '/', 1) <> v_owner_id::text
     OR split_part(p_agreement_photo_url, '/', 1) <> v_owner_id::text
     OR split_part(p_id_photo_url, '/', 2) <> p_room_id::text
     OR split_part(p_agreement_photo_url, '/', 2) <> p_room_id::text
     OR split_part(p_id_photo_url, '/', 4) <> 'id'
     OR split_part(p_agreement_photo_url, '/', 4) <> 'agreement'
     OR split_part(p_id_photo_url, '/', 3) !~ '^[a-z0-9-]{10,80}$'
     OR split_part(p_agreement_photo_url, '/', 3) !~ '^[a-z0-9-]{10,80}$'
     OR split_part(p_id_photo_url, '/', 5) !~* '^[a-z0-9-]+\.(jpe?g|png|webp)$'
     OR split_part(p_agreement_photo_url, '/', 5) !~* '^[a-z0-9-]+\.(jpe?g|png|webp)$' THEN
    RAISE EXCEPTION 'Tenant documents must use unique paths in the signed-in owner room folder';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.rooms r
    JOIN public.boarding_house bh ON bh.boarding_house_id = r.boarding_house_id
    WHERE r.room_id = p_room_id
      AND bh.owner_id = v_owner_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.tenancy existing
        WHERE existing.room_id = r.room_id
          AND existing.status IN ('active', 'scheduled')
      )
  ) THEN
    RAISE EXCEPTION 'Room is unavailable or is not owned by this account';
  END IF;

  IF p_custom_charges IS NULL OR jsonb_typeof(p_custom_charges) <> 'array' THEN
    RAISE EXCEPTION 'Custom charges must be an array';
  END IF;

  INSERT INTO public.tenants (owner_id, name, contact_number, email_address, id_photo_url)
  VALUES (v_owner_id, btrim(p_name), nullif(btrim(p_contact_number), ''),
          nullif(btrim(p_email_address), ''), p_id_photo_url)
  RETURNING tenant_id INTO v_tenant_id;

  INSERT INTO public.tenancy (
    owner_id, tenant_id, room_id, move_in_date, agreement_photo_url
  )
  VALUES (v_owner_id, v_tenant_id, p_room_id, p_move_in_date, p_agreement_photo_url)
  RETURNING tenancy_id INTO v_tenancy_id;

  FOR v_charge IN
    SELECT item_type, unit_price
    FROM jsonb_to_recordset(p_custom_charges)
      AS custom_charge(item_type text, unit_price numeric)
  LOOP
    IF v_charge.item_type IS NULL
       OR v_charge.item_type NOT IN ('water', 'trash', 'wifi', 'electricity')
       OR v_charge.unit_price IS NULL
       OR v_charge.unit_price < 0
       OR v_charge.unit_price >= 'Infinity'::numeric
       OR v_charge.unit_price = 'NaN'::numeric
       OR scale(v_charge.unit_price) > 2 THEN
      RAISE EXCEPTION 'Custom charge type or rate is invalid';
    END IF;

    INSERT INTO public.tenancy_default_charges (tenancy_id, item_type, unit_price)
    VALUES (v_tenancy_id, v_charge.item_type::public.bill_item_type, v_charge.unit_price);
  END LOOP;

  IF p_move_in_date <= v_today THEN
    v_period_start := p_move_in_date;
    WHILE v_period_start <= v_today LOOP
      v_period_end :=
        public.cycle_date(p_move_in_date, (v_period_start + interval '1 month')::date) - 1;
      PERFORM public.generate_monthly_bill(
        v_tenancy_id,
        v_period_start,
        v_period_end,
        v_period_end
      );
      v_period_start := v_period_end + 1;
    END LOOP;
  END IF;

  RETURN v_tenancy_id;
END;
$_$;


ALTER FUNCTION "public"."register_tenancy"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_tenancy_with_opening_reading"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb", "p_opening_reading_value" numeric) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tenancy_id uuid;
  v_room_id uuid;
  v_move_in_date date;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_previous_move_out_date date;
  v_existing public.meter_readings%ROWTYPE;
BEGIN
  IF p_opening_reading_value IS NOT NULL
     AND (
       p_opening_reading_value < 0
       OR p_opening_reading_value >= 'Infinity'::numeric
       OR p_opening_reading_value = 'NaN'::numeric
     ) THEN
    RAISE EXCEPTION 'The opening meter reading must be a valid nonnegative value';
  END IF;

  SELECT max(move_out_date)
  INTO v_previous_move_out_date
  FROM public.tenancy
  WHERE room_id = p_room_id
    AND move_out_date IS NOT NULL
    AND owner_id = (SELECT auth.uid());

  IF v_previous_move_out_date IS NOT NULL
     AND p_move_in_date < v_previous_move_out_date THEN
    RAISE EXCEPTION
      'The move-in date must be on or after %, because the previous tenancy occupied this room until then.',
      v_previous_move_out_date;
  END IF;

  v_tenancy_id := public.register_tenancy(
    p_room_id,
    p_name,
    p_contact_number,
    p_email_address,
    p_id_photo_url,
    p_agreement_photo_url,
    p_move_in_date,
    p_custom_charges
  );

  SELECT room_id, move_in_date
  INTO v_room_id, v_move_in_date
  FROM public.tenancy
  WHERE tenancy_id = v_tenancy_id;

  SELECT *
  INTO v_existing
  FROM public.meter_readings
  WHERE room_id = v_room_id
    AND reading_at = v_move_in_date
  ORDER BY reading_id
  LIMIT 1;

  IF FOUND THEN
    IF p_opening_reading_value IS NOT NULL
       AND v_existing.reading_value <> p_opening_reading_value THEN
      RAISE EXCEPTION 'The existing reading on the move-in date does not match the opening reading';
    END IF;
    RETURN v_tenancy_id;
  END IF;

  IF p_opening_reading_value IS NULL THEN
    IF v_move_in_date <= v_today THEN
      RAISE EXCEPTION 'An opening meter reading is required for a tenancy that has started';
    END IF;
    RETURN v_tenancy_id;
  END IF;

  INSERT INTO public.meter_readings (room_id, reading_value, reading_at)
  VALUES (v_room_id, p_opening_reading_value, v_move_in_date);

  RETURN v_tenancy_id;
END;
$$;


ALTER FUNCTION "public"."register_tenancy_with_opening_reading"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb", "p_opening_reading_value" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_tenant_documents"("p_tenant_id" "uuid", "p_action" "text", "p_archived_id_path" "text" DEFAULT NULL::"text", "p_archived_agree_path" "text" DEFAULT NULL::"text") RETURNS TABLE("id_photo_path" "text", "agreement_photo_path" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  t public.tenants;
  r public.rooms;
  b public.boarding_house;
begin
  if p_action not in ('archive', 'delete') then
    raise exception 'p_action must be ''archive'' or ''delete''';
  end if;

  select * into t from public.tenants where tenant_id = p_tenant_id;  -- RLS applies
  if not found then
    raise exception 'Tenant not found';
  end if;
  if t.end_date is null then
    raise exception 'Tenant has not moved out yet';
  end if;
  if t.documents_status <> 'active' then
    raise exception 'Documents already %', t.documents_status;
  end if;

  if p_action = 'archive' then
    select * into r from public.rooms where room_id = t.room_id;
    select * into b from public.boarding_house where boarding_house_id = r.boarding_house_id;

    insert into public.tenant_archive (
      owner_id, tenant_id, tenant_name, contact_number, email_address,
      start_date, end_date, room_name, boarding_house_name, boarding_house_address,
      id_photo_path, agreement_photo_path
    ) values (
      b.owner_id, t.tenant_id, t.name, t.contact_number, t.email_address,
      t.start_date, t.end_date, r.room_name, b.name, b.address,
      coalesce(p_archived_id_path, t.id_photo_url),
      coalesce(p_archived_agree_path, t.agreement_photo_url)
    );

    -- Paths now live in the archive; clear them from the live tenant row.
    update public.tenants
       set documents_status = 'archived',
           documents_resolved_at = now(),
           id_photo_url = null,
           agreement_photo_url = null
     where tenant_id = p_tenant_id;
  else
    update public.tenants
       set documents_status = 'deleted',
           documents_resolved_at = now(),
           id_photo_url = null,
           agreement_photo_url = null
     where tenant_id = p_tenant_id;
  end if;

  -- Return the ORIGINAL paths so the app can move or delete the files.
  return query select t.id_photo_url, t.agreement_photo_url;
end;
$$;


ALTER FUNCTION "public"."resolve_tenant_documents"("p_tenant_id" "uuid", "p_action" "text", "p_archived_id_path" "text", "p_archived_agree_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_tenant_list"("p_status" "text", "p_search" "text" DEFAULT ''::"text", "p_offset" integer DEFAULT 0, "p_limit" integer DEFAULT 10) RETURNS TABLE("record_id" "uuid", "tenant_name" "text", "room_name" "text", "boarding_house_name" "text", "room_id" "uuid", "boarding_house_id" "uuid", "move_in_date" "date", "move_out_date" "date", "total_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  WITH normalized_search AS (
    SELECT NULLIF(
      btrim(regexp_replace(coalesce(p_search, ''), '[[:space:]]+', ' ', 'g')),
      ''
    ) AS search_text
  ),
  search_tokens AS (
    SELECT regexp_split_to_table(search_text, E'\\s+') AS token
    FROM normalized_search
    WHERE search_text IS NOT NULL
  ),
  candidates AS (
    SELECT
      tenancy.tenancy_id AS record_id,
      tenant.name::text AS tenant_name,
      room.room_name::text AS room_name,
      house.name::text AS boarding_house_name,
      room.room_id,
      house.boarding_house_id,
      tenancy.move_in_date,
      NULL::date AS move_out_date,
      tenancy.owner_id
    FROM public.tenancy AS tenancy
    JOIN public.tenants AS tenant ON tenant.tenant_id = tenancy.tenant_id
    JOIN public.rooms AS room ON room.room_id = tenancy.room_id
    JOIN public.boarding_house AS house
      ON house.boarding_house_id = room.boarding_house_id
    WHERE p_status IN ('active', 'scheduled')
      AND tenancy.status = p_status
      AND tenancy.owner_id = auth.uid()

    UNION ALL

    SELECT
      archive.archive_id AS record_id,
      archive.tenant_name,
      archive.room_name::text,
      archive.boarding_house_name,
      NULL::uuid AS room_id,
      NULL::uuid AS boarding_house_id,
      archive.move_in_date,
      archive.move_out_date,
      archive.owner_id
    FROM public.tenant_archive AS archive
    WHERE p_status = 'archived'
      AND archive.owner_id = auth.uid()
  ),
  matched AS (
    SELECT candidate.*
    FROM candidates AS candidate
    WHERE candidate.owner_id = auth.uid()
      AND NOT EXISTS (
        SELECT 1
        FROM search_tokens AS search_token
        WHERE concat_ws(
          ' ',
          candidate.tenant_name,
          candidate.room_name,
          candidate.boarding_house_name
        ) NOT ILIKE (
          '%' ||
          replace(
            replace(
              replace(search_token.token, E'\\', E'\\\\'),
              '%',
              E'\\%'
            ),
            '_',
            E'\\_'
          ) ||
          '%'
        ) ESCAPE E'\\'
      )
  ),
  paged AS (
    SELECT matched.*, count(*) OVER () AS total_count
    FROM matched
    ORDER BY
      CASE WHEN p_status = 'scheduled' THEN move_in_date END ASC,
      CASE WHEN p_status = 'active' THEN move_in_date END DESC,
      CASE WHEN p_status = 'archived' THEN move_out_date END DESC,
      record_id ASC
    OFFSET greatest(coalesce(p_offset, 0), 0)
    LIMIT least(greatest(coalesce(p_limit, 10), 1), 100)
  )
  SELECT
    paged.record_id,
    paged.tenant_name,
    paged.room_name,
    paged.boarding_house_name,
    paged.room_id,
    paged.boarding_house_id,
    paged.move_in_date,
    paged.move_out_date,
    paged.total_count
  FROM paged
  ORDER BY
    CASE WHEN p_status = 'scheduled' THEN paged.move_in_date END ASC,
    CASE WHEN p_status = 'active' THEN paged.move_in_date END DESC,
    CASE WHEN p_status = 'archived' THEN paged.move_out_date END DESC,
    paged.record_id ASC;
$$;


ALTER FUNCTION "public"."search_tenant_list"("p_status" "text", "p_search" "text", "p_offset" integer, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_electricity_quantity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_start public.meter_readings%ROWTYPE;
  v_end public.meter_readings%ROWTYPE;
  v_bill_start date;
  v_bill_end date;
  v_move_in date;
  v_move_out date;
  v_tenancy_id uuid;
  v_room_id uuid;
  v_rate numeric;
  v_is_final_move_out boolean := coalesce(current_setting('inkeeper.final_move_out_bill_id', true) = new.bill_id::text, false);
BEGIN
  IF new.item_type <> 'electricity' THEN
    new.start_reading_id := NULL;
    new.end_reading_id := NULL;
    RETURN new;
  END IF;
  IF TG_OP = 'UPDATE' AND new.start_reading_id IS NOT DISTINCT FROM old.start_reading_id AND new.end_reading_id IS NOT DISTINCT FROM old.end_reading_id THEN
    SELECT * INTO v_start FROM public.meter_readings WHERE reading_id = new.start_reading_id;
    SELECT * INTO v_end FROM public.meter_readings WHERE reading_id = new.end_reading_id;
    IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'IK011', MESSAGE = 'The bill meter reading is not valid', HINT = 'invalid_reading_link'; END IF;
    IF v_end.reading_at <= v_start.reading_at OR v_end.reading_value < v_start.reading_value THEN RAISE EXCEPTION USING ERRCODE = 'IK009', MESSAGE = 'The new reading cannot be lower than the previous reading.', HINT = 'value_below_previous'; END IF;
    new.quantity := v_end.reading_value - v_start.reading_value;
    new.unit_price := old.unit_price;
    RETURN new;
  END IF;
  IF new.start_reading_id IS NULL OR new.end_reading_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'IK011', MESSAGE = 'Electricity items need a start and an end reading', HINT = 'invalid_reading_link'; END IF;
  SELECT * INTO v_start FROM public.meter_readings WHERE reading_id = new.start_reading_id;
  SELECT * INTO v_end FROM public.meter_readings WHERE reading_id = new.end_reading_id;
  IF v_start.reading_id IS NULL OR v_end.reading_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'IK011', MESSAGE = 'Meter reading not found', HINT = 'invalid_reading_link'; END IF;
  SELECT bill.period_start, bill.period_end, tenancy.tenancy_id, tenancy.room_id, tenancy.move_in_date, tenancy.move_out_date
  INTO v_bill_start, v_bill_end, v_tenancy_id, v_room_id, v_move_in, v_move_out
  FROM public.monthly_bill AS bill JOIN public.tenancy AS tenancy ON tenancy.tenancy_id = bill.tenancy_id WHERE bill.bill_id = new.bill_id;
  IF v_tenancy_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'IK010', MESSAGE = 'Bill tenancy not found', HINT = 'not_authorized'; END IF;
  IF v_start.room_id <> v_end.room_id OR v_start.room_id <> v_room_id THEN RAISE EXCEPTION USING ERRCODE = 'IK011', MESSAGE = 'Both readings must belong to the bill''s room', HINT = 'invalid_reading_link'; END IF;
  IF v_end.reading_at <= v_start.reading_at OR v_end.reading_value < v_start.reading_value THEN RAISE EXCEPTION USING ERRCODE = 'IK009', MESSAGE = 'End reading must be later and not lower than the start reading', HINT = 'value_below_previous'; END IF;
  IF v_start.reading_at < v_move_in OR v_end.reading_at < v_move_in OR (NOT v_is_final_move_out AND ((v_move_out IS NOT NULL AND (v_start.reading_at > v_move_out OR v_end.reading_at > v_move_out)) OR v_end.reading_at < v_bill_start OR v_end.reading_at > v_bill_end)) THEN
    RAISE EXCEPTION USING ERRCODE = 'IK011', MESSAGE = 'Readings must fall within this tenancy and the bill period', HINT = 'invalid_reading_link';
  END IF;
  IF NOT v_is_final_move_out AND EXISTS (SELECT 1 FROM public.tenancy AS other_tenancy WHERE other_tenancy.room_id = v_room_id AND other_tenancy.tenancy_id <> v_tenancy_id AND other_tenancy.move_in_date < v_end.reading_at AND coalesce(other_tenancy.move_out_date, 'infinity'::date) > v_start.reading_at) THEN
    RAISE EXCEPTION USING ERRCODE = 'IK011', MESSAGE = 'The meter interval overlaps another tenancy', HINT = 'invalid_reading_link';
  END IF;
  SELECT coalesce(tenancy_charge.unit_price, owner_charge.unit_price) INTO v_rate
  FROM public.tenancy AS tenancy
  LEFT JOIN public.tenancy_default_charges AS tenancy_charge ON tenancy_charge.tenancy_id = tenancy.tenancy_id AND tenancy_charge.item_type = 'electricity'
  LEFT JOIN public.owner_default_charges AS owner_charge ON owner_charge.owner_id = tenancy.owner_id AND owner_charge.item_type = 'electricity'
  WHERE tenancy.tenancy_id = v_tenancy_id;
  IF v_rate IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'IK011', MESSAGE = 'Set an electricity rate for this tenancy or owner before billing', HINT = 'missing_electricity_rate'; END IF;
  new.quantity := v_end.reading_value - v_start.reading_value;
  new.unit_price := v_rate;
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."set_electricity_quantity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_room_rent_amount"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$begin
  if new.monthly_rate is null then
    select r.monthly_rate into new.monthly_rate
    from public.rooms r
    where r.room_id = new.room_id;
  end if;
  return new;
end;$$;


ALTER FUNCTION "public"."set_room_rent_amount"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_tenancy_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Asia/Manila')::date;
BEGIN
  NEW.status := CASE
    WHEN NEW.status = 'ended'
      AND (
        (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'ended')
        OR NEW.room_id IS NULL
      ) THEN 'ended'
    WHEN NEW.move_out_date IS NOT NULL AND NEW.move_out_date <= today THEN 'ended'
    WHEN NEW.move_in_date <= today THEN 'active'
    ELSE 'scheduled'
  END;
  NEW.last_updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_tenancy_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_meter_reading_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_previous public.meter_readings%ROWTYPE;
  v_anchor date;
  v_cycle_start date;
  v_next_cycle_start date;
  v_is_final_move_out boolean := coalesce(
    current_setting('inkeeper.final_move_out_room_id', true) = new.room_id::text,
    false
  );
BEGIN
  IF new.reading_value < 0
     OR new.reading_value >= 'Infinity'::numeric
     OR new.reading_value = 'NaN'::numeric THEN
    RAISE EXCEPTION 'The meter reading must be a valid nonnegative value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('meter:' || new.room_id::text, 0));
  PERFORM 1 FROM public.rooms r WHERE r.room_id = new.room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found or not authorized'; END IF;
  SELECT * INTO v_previous FROM public.meter_readings WHERE room_id = new.room_id ORDER BY reading_at DESC, reading_id DESC LIMIT 1;
  IF FOUND THEN
    IF new.reading_at <= v_previous.reading_at THEN RAISE EXCEPTION 'The reading date must be later than the previous reading'; END IF;
    IF new.reading_value < v_previous.reading_value THEN RAISE EXCEPTION 'The reading cannot be lower than the previous reading'; END IF;
  END IF;
  SELECT move_in_date INTO v_anchor FROM public.tenancy WHERE room_id = new.room_id AND status IN ('active', 'scheduled') ORDER BY move_in_date DESC LIMIT 1;
  IF NOT v_is_final_move_out AND v_anchor IS NOT NULL AND new.reading_at >= v_anchor THEN
    v_cycle_start := public.cycle_date(v_anchor, new.reading_at);
    v_next_cycle_start := public.cycle_date(v_anchor, (v_cycle_start + interval '1 month')::date);
    IF EXISTS (
      SELECT 1 FROM public.meter_readings existing
      WHERE existing.room_id = new.room_id
        AND existing.reading_at >= v_cycle_start
        AND existing.reading_at < v_next_cycle_start
        AND NOT EXISTS (
          SELECT 1 FROM public.tenancy t
          WHERE t.room_id = new.room_id
            AND (t.move_in_date = existing.reading_at OR t.move_out_date = existing.reading_at)
        )
    ) THEN
      RAISE EXCEPTION 'A meter reading already exists for this billing cycle';
    END IF;
  END IF;
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."validate_meter_reading_insert"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "private"."bill_reminders_backup_20261121" (
    "reminder_id" "uuid",
    "bill_id" "uuid",
    "reminder_type" "text",
    "sent_at" timestamp with time zone,
    "delivery_status" "text",
    "attempt_count" integer,
    "attempt_started_at" timestamp with time zone,
    "next_attempt_at" timestamp with time zone,
    "last_error" "text"
);


ALTER TABLE "private"."bill_reminders_backup_20261121" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bill_items" (
    "bill_item_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_id" "uuid" NOT NULL,
    "item_type" "public"."bill_item_type" NOT NULL,
    "description" "text",
    "quantity" numeric(12,2) DEFAULT 1 NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "start_reading_id" "uuid",
    "end_reading_id" "uuid",
    "amount" numeric GENERATED ALWAYS AS (("quantity" * "unit_price")) STORED,
    CONSTRAINT "bill_items_check" CHECK ((("item_type" = 'adjustment'::"public"."bill_item_type") OR ("unit_price" >= (0)::numeric))),
    CONSTRAINT "bill_items_check1" CHECK ((("item_type" = 'electricity'::"public"."bill_item_type") OR (("start_reading_id" IS NULL) AND ("end_reading_id" IS NULL))))
);


ALTER TABLE "public"."bill_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bill_meter_reading_corrections" (
    "correction_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "request_id" "text" NOT NULL,
    "bill_id" "uuid" NOT NULL,
    "reading_id" "uuid" NOT NULL,
    "old_value" numeric NOT NULL,
    "new_value" numeric NOT NULL,
    "corrected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "usage" numeric NOT NULL,
    "unit_price" numeric NOT NULL,
    "electricity_charge" numeric NOT NULL,
    "total_amount" numeric NOT NULL,
    CONSTRAINT "bill_meter_reading_corrections_request_id_check" CHECK ((("length"("btrim"("request_id")) >= 8) AND ("length"("btrim"("request_id")) <= 100))),
    CONSTRAINT "bill_meter_reading_corrections_values_check" CHECK ((("old_value" >= (0)::numeric) AND ("old_value" < 'Infinity'::numeric) AND ("old_value" <> 'NaN'::numeric) AND ("new_value" >= (0)::numeric) AND ("new_value" < 'Infinity'::numeric) AND ("new_value" <> 'NaN'::numeric)))
);


ALTER TABLE "public"."bill_meter_reading_corrections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bill_reminders" (
    "reminder_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bill_id" "uuid" NOT NULL,
    "reminder_type" "public"."reminder_type" NOT NULL,
    "sent_at" timestamp with time zone,
    "delivery_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "attempt_started_at" timestamp with time zone,
    "retry_at" timestamp with time zone,
    "last_error" "text",
    "reminder_day" "date",
    "message_id" "text",
    "client_request_id" "text",
    CONSTRAINT "bill_reminders_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "bill_reminders_client_request_id_check" CHECK ((("client_request_id" IS NULL) OR ("length"("client_request_id") <= 100))),
    CONSTRAINT "bill_reminders_delivery_status_check" CHECK (("delivery_status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'uncertain'::"text"]))),
    CONSTRAINT "bill_reminders_message_id_check" CHECK ((("message_id" IS NULL) OR ("length"("message_id") <= 500))),
    CONSTRAINT "bill_reminders_reminder_day_check" CHECK (((("reminder_type" = 'tenant_bill_sent'::"public"."reminder_type") AND ("reminder_day" IS NULL)) OR (("reminder_type" <> 'tenant_bill_sent'::"public"."reminder_type") AND ("reminder_day" IS NOT NULL)))),
    CONSTRAINT "bill_reminders_sent_state_check" CHECK (((("delivery_status" = 'sent'::"text") AND ("sent_at" IS NOT NULL)) OR (("delivery_status" <> 'sent'::"text") AND ("sent_at" IS NULL))))
);


ALTER TABLE "public"."bill_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boarding_house" (
    "boarding_house_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "address" "text",
    "last_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."boarding_house" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."device_push_tokens" (
    "expo_push_token" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "device_push_tokens_expo_push_token_check" CHECK ((("length"("expo_push_token") >= 1) AND ("length"("expo_push_token") <= 255))),
    CONSTRAINT "device_push_tokens_platform_check" CHECK (("platform" = ANY (ARRAY['ios'::"text", 'android'::"text"])))
);


ALTER TABLE "public"."device_push_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meter_readings" (
    "reading_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid",
    "reading_value" numeric(12,2) NOT NULL,
    "reading_at" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "meter_readings_reading_value_check" CHECK (("reading_value" >= (0)::numeric))
);


ALTER TABLE "public"."meter_readings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_bill" (
    "bill_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenancy_id" "uuid" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "due_date" "date" NOT NULL,
    "billed_at" timestamp with time zone,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "paid_at" timestamp with time zone,
    "is_paid" boolean GENERATED ALWAYS AS (("paid_at" IS NOT NULL)) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "electricity_roll_forward_to_bill_id" "uuid",
    CONSTRAINT "monthly_bill_check" CHECK (("period_end" >= "period_start")),
    CONSTRAINT "monthly_bill_electricity_roll_forward_not_self" CHECK ((("electricity_roll_forward_to_bill_id" IS NULL) OR ("electricity_roll_forward_to_bill_id" <> "bill_id")))
);


ALTER TABLE "public"."monthly_bill" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "notification_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "related_bill_id" "uuid",
    "related_tenancy_id" "uuid",
    "related_room_id" "uuid",
    "related_record_id" "uuid" GENERATED ALWAYS AS (COALESCE("related_bill_id", "related_tenancy_id", "related_room_id")) STORED,
    "related_record_type" "text" GENERATED ALWAYS AS (
CASE
    WHEN ("related_bill_id" IS NOT NULL) THEN 'monthly_bill'::"text"
    WHEN ("related_tenancy_id" IS NOT NULL) THEN 'tenancy'::"text"
    WHEN ("related_room_id" IS NOT NULL) THEN 'room'::"text"
    ELSE NULL::"text"
END) STORED,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    CONSTRAINT "notifications_data_check" CHECK (("jsonb_typeof"("data") = 'object'::"text")),
    CONSTRAINT "notifications_event_key_check" CHECK ((("length"("event_key") >= 1) AND ("length"("event_key") <= 200))),
    CONSTRAINT "notifications_message_check" CHECK (("length"("btrim"("message")) > 0)),
    CONSTRAINT "notifications_read_state_check" CHECK ((("is_read" AND ("read_at" IS NOT NULL)) OR ((NOT "is_read") AND ("read_at" IS NULL)))),
    CONSTRAINT "notifications_single_related_record_check" CHECK (("num_nonnulls"("related_bill_id", "related_tenancy_id", "related_room_id") <= 1)),
    CONSTRAINT "notifications_title_check" CHECK (("length"("btrim"("title")) > 0)),
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['bill_generated'::"text", 'bill_due_soon'::"text", 'bill_due_today'::"text", 'bill_paid'::"text", 'tenant_registered'::"text", 'tenant_moved_in'::"text", 'tenancy_ended'::"text", 'meter_reading_required'::"text", 'electricity_charge_added'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."owner_default_charges" (
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "item_type" "public"."bill_item_type" NOT NULL,
    "unit_price" numeric NOT NULL,
    CONSTRAINT "owner_default_charges_item_type_check" CHECK ((("item_type")::"text" = ANY (ARRAY['water'::"text", 'trash'::"text", 'wifi'::"text", 'electricity'::"text"]))),
    CONSTRAINT "owner_default_charges_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."owner_default_charges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."owner_profile" (
    "id" "uuid" NOT NULL,
    "full_name" "text" DEFAULT 'NULL'::"text",
    "phone_number" "text",
    "email_address" "text",
    "last_updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."owner_profile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."room_creation_requests" (
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "request_id" "text" NOT NULL,
    "room_id" "uuid" NOT NULL,
    "boarding_house_id" "uuid" NOT NULL,
    "room_name" "text" NOT NULL,
    "monthly_rate" numeric NOT NULL,
    "initial_reading_value" numeric,
    "initial_reading_at" "date",
    CONSTRAINT "room_creation_requests_reading_pair_check" CHECK ((("initial_reading_value" IS NULL) = ("initial_reading_at" IS NULL)))
);


ALTER TABLE "public"."room_creation_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."room_default_charges" (
    "rooom_id" "uuid" NOT NULL,
    "item_type" "public"."bill_item_type" NOT NULL,
    "unit_price" numeric
);


ALTER TABLE "public"."room_default_charges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rooms" (
    "room_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "boarding_house_id" "uuid" NOT NULL,
    "monthly_rate" numeric(10,2) NOT NULL,
    "room_name" character varying NOT NULL,
    "is_occupied" boolean DEFAULT false NOT NULL,
    "last_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenancy" (
    "tenancy_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "room_id" "uuid",
    "move_in_date" "date" DEFAULT CURRENT_DATE,
    "move_out_date" "date",
    "monthly_rate" numeric,
    "billing_cycle_start" "text" DEFAULT "to_char"((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::"text"),
    "status" character varying(10) DEFAULT 'active'::character varying NOT NULL,
    "agreement_photo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_updated_at" timestamp with time zone,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    CONSTRAINT "tenancy_dates_check" CHECK ((("move_out_date" IS NULL) OR ("move_out_date" >= "move_in_date"))),
    CONSTRAINT "tenancy_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['scheduled'::character varying, 'active'::character varying, 'ended'::character varying])::"text"[])))
);


ALTER TABLE "public"."tenancy" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenancy_default_charges" (
    "tenancy_id" "uuid" NOT NULL,
    "item_type" "public"."bill_item_type" NOT NULL,
    "unit_price" numeric NOT NULL,
    CONSTRAINT "tenancy_default_charges_item_type_check" CHECK (("item_type" = ANY (ARRAY['water'::"public"."bill_item_type", 'trash'::"public"."bill_item_type", 'wifi'::"public"."bill_item_type", 'electricity'::"public"."bill_item_type"]))),
    CONSTRAINT "tenancy_default_charges_unit_price_check" CHECK ((("unit_price" >= (0)::numeric) AND ("unit_price" < 'Infinity'::numeric) AND ("unit_price" <> 'NaN'::numeric) AND ("scale"("unit_price") <= 2)))
);


ALTER TABLE "public"."tenancy_default_charges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_archive" (
    "archive_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "tenant_id" "uuid",
    "tenant_name" "text" NOT NULL,
    "contact_number" character varying,
    "email_address" character varying,
    "move_in_date" "date" NOT NULL,
    "move_out_date" "date" NOT NULL,
    "room_name" character varying,
    "boarding_house_name" "text",
    "boarding_house_address" "text",
    "id_photo_path" "text",
    "agreement_photo_path" "text",
    "notes" "text",
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenancy_id" "uuid"
);


ALTER TABLE "public"."tenant_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "tenant_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" character varying NOT NULL,
    "contact_number" character varying,
    "email_address" character varying,
    "id_photo_url" "text",
    "last_updated_at" timestamp with time zone
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_pkey" PRIMARY KEY ("bill_item_id");



ALTER TABLE ONLY "public"."bill_meter_reading_corrections"
    ADD CONSTRAINT "bill_meter_reading_corrections_owner_request_key" UNIQUE ("owner_id", "request_id");



ALTER TABLE ONLY "public"."bill_meter_reading_corrections"
    ADD CONSTRAINT "bill_meter_reading_corrections_pkey" PRIMARY KEY ("correction_id");



ALTER TABLE ONLY "public"."bill_reminders"
    ADD CONSTRAINT "bill_reminders_bill_type_day_key" UNIQUE NULLS NOT DISTINCT ("bill_id", "reminder_type", "reminder_day");



ALTER TABLE ONLY "public"."bill_reminders"
    ADD CONSTRAINT "bill_reminders_pkey" PRIMARY KEY ("reminder_id");



ALTER TABLE ONLY "public"."boarding_house"
    ADD CONSTRAINT "boarding_house_pkey" PRIMARY KEY ("boarding_house_id");



ALTER TABLE ONLY "public"."device_push_tokens"
    ADD CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("expo_push_token");



ALTER TABLE ONLY "public"."meter_readings"
    ADD CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("reading_id");



ALTER TABLE ONLY "public"."meter_readings"
    ADD CONSTRAINT "meter_readings_room_id_reading_at_key" UNIQUE ("room_id", "reading_at");



ALTER TABLE ONLY "public"."monthly_bill"
    ADD CONSTRAINT "monthly_bill_pkey" PRIMARY KEY ("bill_id");



ALTER TABLE ONLY "public"."monthly_bill"
    ADD CONSTRAINT "monthly_bill_tenancy_id_period_start_key" UNIQUE ("tenancy_id", "period_start");



ALTER TABLE ONLY "public"."tenancy"
    ADD CONSTRAINT "no_overlapping_tenancies" EXCLUDE USING "gist" ("room_id" WITH =, "daterange"("move_in_date", "move_out_date", '[)'::"text") WITH &&);



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_owner_event_key_key" UNIQUE ("owner_id", "event_key");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("notification_id");



ALTER TABLE ONLY "public"."owner_default_charges"
    ADD CONSTRAINT "owner_default_charges_pkey" PRIMARY KEY ("owner_id", "item_type");



ALTER TABLE ONLY "public"."owner_profile"
    ADD CONSTRAINT "owner_profile_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenancy"
    ADD CONSTRAINT "pk_tenancy_id" PRIMARY KEY ("tenancy_id");



ALTER TABLE ONLY "public"."room_creation_requests"
    ADD CONSTRAINT "room_creation_requests_pkey" PRIMARY KEY ("owner_id", "request_id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_pkey" PRIMARY KEY ("room_id");



ALTER TABLE ONLY "public"."tenancy_default_charges"
    ADD CONSTRAINT "tenancy_default_charges_pkey" PRIMARY KEY ("tenancy_id", "item_type");



ALTER TABLE ONLY "public"."tenant_archive"
    ADD CONSTRAINT "tenant_archive_pkey" PRIMARY KEY ("archive_id");



ALTER TABLE ONLY "public"."tenant_archive"
    ADD CONSTRAINT "tenant_archive_tenancy_id_key" UNIQUE ("tenancy_id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenant_pkey" PRIMARY KEY ("tenant_id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_last_updated_at_key" UNIQUE ("id_photo_url");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "unique_boarding_house_room" UNIQUE ("boarding_house_id", "room_name");



CREATE INDEX "bill_items_bill_id_idx" ON "public"."bill_items" USING "btree" ("bill_id");



CREATE INDEX "bill_meter_reading_corrections_bill_id_idx" ON "public"."bill_meter_reading_corrections" USING "btree" ("bill_id", "corrected_at" DESC);



CREATE INDEX "bill_meter_reading_corrections_reading_id_idx" ON "public"."bill_meter_reading_corrections" USING "btree" ("reading_id", "corrected_at" DESC);



CREATE INDEX "bill_reminders_bill_id_idx" ON "public"."bill_reminders" USING "btree" ("bill_id");



CREATE INDEX "boarding_house_name_idx" ON "public"."boarding_house" USING "btree" ("name");



CREATE INDEX "device_push_tokens_owner_id_idx" ON "public"."device_push_tokens" USING "btree" ("owner_id");



CREATE INDEX "meter_readings_room_id_idx" ON "public"."meter_readings" USING "btree" ("room_id");



CREATE INDEX "meter_readings_room_id_reading_at_idx" ON "public"."meter_readings" USING "btree" ("room_id", "reading_at" DESC);



CREATE INDEX "monthly_bill_created_at_idx" ON "public"."monthly_bill" USING "btree" ("created_at");



CREATE INDEX "monthly_bill_due_date_idx" ON "public"."monthly_bill" USING "btree" ("due_date") WHERE ("paid_at" IS NULL);



CREATE INDEX "monthly_bill_electricity_roll_forward_to_idx" ON "public"."monthly_bill" USING "btree" ("electricity_roll_forward_to_bill_id") WHERE ("electricity_roll_forward_to_bill_id" IS NOT NULL);



CREATE INDEX "monthly_bill_tenancy_id_period_start_idx" ON "public"."monthly_bill" USING "btree" ("tenancy_id", "period_start");



CREATE INDEX "notifications_owner_created_at_idx" ON "public"."notifications" USING "btree" ("owner_id", "created_at" DESC);



CREATE INDEX "notifications_owner_unread_created_at_idx" ON "public"."notifications" USING "btree" ("owner_id", "created_at" DESC) WHERE (NOT "is_read");



CREATE INDEX "notifications_related_bill_id_idx" ON "public"."notifications" USING "btree" ("related_bill_id") WHERE ("related_bill_id" IS NOT NULL);



CREATE INDEX "notifications_related_room_id_idx" ON "public"."notifications" USING "btree" ("related_room_id") WHERE ("related_room_id" IS NOT NULL);



CREATE INDEX "notifications_related_tenancy_id_idx" ON "public"."notifications" USING "btree" ("related_tenancy_id") WHERE ("related_tenancy_id" IS NOT NULL);



CREATE INDEX "owner_default_charges_owner_id_idx" ON "public"."owner_default_charges" USING "btree" ("owner_id");



CREATE INDEX "room_default_charges_rooom_id_idx" ON "public"."room_default_charges" USING "btree" ("rooom_id");



CREATE INDEX "tenancy_default_charges_tenancy_id_idx" ON "public"."tenancy_default_charges" USING "btree" ("tenancy_id");



CREATE INDEX "tenancy_owner_agreement_photo_url_idx" ON "public"."tenancy" USING "btree" ("agreement_photo_url", "owner_id") WHERE ("agreement_photo_url" IS NOT NULL);



CREATE INDEX "tenancy_owner_id_idx" ON "public"."tenancy" USING "btree" ("owner_id");



CREATE INDEX "tenancy_room_id_idx" ON "public"."tenancy" USING "btree" ("room_id");



CREATE INDEX "tenancy_status_idx" ON "public"."tenancy" USING "btree" ("status");



CREATE INDEX "tenancy_tenant_id_idx" ON "public"."tenancy" USING "btree" ("tenant_id");



CREATE INDEX "tenant_archive_owner_agreement_photo_path_idx" ON "public"."tenant_archive" USING "btree" ("agreement_photo_path", "owner_id") WHERE ("agreement_photo_path" IS NOT NULL);



CREATE INDEX "tenant_archive_owner_id_photo_path_idx" ON "public"."tenant_archive" USING "btree" ("id_photo_path", "owner_id") WHERE ("id_photo_path" IS NOT NULL);



CREATE INDEX "tenant_archive_owner_idx" ON "public"."tenant_archive" USING "btree" ("owner_id", "archived_at" DESC);



CREATE INDEX "tenant_archive_tenant_id_idx" ON "public"."tenant_archive" USING "btree" ("tenant_id");



CREATE INDEX "tenants_name_idx" ON "public"."tenants" USING "btree" ("name");



CREATE INDEX "tenants_owner_id_photo_url_idx" ON "public"."tenants" USING "btree" ("id_photo_url", "owner_id") WHERE ("id_photo_url" IS NOT NULL);



CREATE OR REPLACE TRIGGER "auto_archive_on_move_out" AFTER INSERT OR UPDATE ON "public"."tenancy" FOR EACH ROW EXECUTE FUNCTION "public"."auto_archive_tenancy"();



CREATE OR REPLACE TRIGGER "bill_items_lock" BEFORE INSERT OR DELETE OR UPDATE ON "public"."bill_items" FOR EACH ROW EXECUTE FUNCTION "public"."block_finalized_bill_edit"();

ALTER TABLE "public"."bill_items" DISABLE TRIGGER "bill_items_lock";



CREATE OR REPLACE TRIGGER "bill_items_total" AFTER INSERT OR DELETE OR UPDATE ON "public"."bill_items" FOR EACH ROW EXECUTE FUNCTION "public"."recalc_bill_total"();



CREATE OR REPLACE TRIGGER "derive_tenancy_status" BEFORE INSERT OR UPDATE OF "move_in_date", "move_out_date" ON "public"."tenancy" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenancy_status"();



CREATE OR REPLACE TRIGGER "electricity_quantity" BEFORE INSERT OR UPDATE ON "public"."bill_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_electricity_quantity"();



CREATE OR REPLACE TRIGGER "guard_electricity_roll_forward_before_issue" BEFORE UPDATE OF "billed_at", "paid_at", "is_paid", "electricity_roll_forward_to_bill_id" ON "public"."monthly_bill" FOR EACH ROW EXECUTE FUNCTION "public"."guard_electricity_roll_forward"();



CREATE OR REPLACE TRIGGER "guard_final_move_out_no_charge" BEFORE INSERT OR DELETE OR UPDATE ON "public"."bill_items" FOR EACH ROW EXECUTE FUNCTION "public"."guard_final_move_out_no_charge"();



CREATE OR REPLACE TRIGGER "notifications_electricity_charge" AFTER INSERT ON "public"."bill_items" FOR EACH ROW EXECUTE FUNCTION "private"."notify_electricity_charge"();



CREATE OR REPLACE TRIGGER "notifications_monthly_bill_events" AFTER INSERT OR UPDATE ON "public"."monthly_bill" FOR EACH ROW EXECUTE FUNCTION "private"."notify_monthly_bill_changes"();



CREATE OR REPLACE TRIGGER "notifications_push_dispatch" AFTER INSERT ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "private"."dispatch_notification_push"();



CREATE OR REPLACE TRIGGER "notifications_tenancy_events" AFTER INSERT OR UPDATE ON "public"."tenancy" FOR EACH ROW EXECUTE FUNCTION "private"."notify_tenancy_changes"();



CREATE OR REPLACE TRIGGER "set_default_monthly_rate" BEFORE INSERT ON "public"."tenancy" FOR EACH ROW EXECUTE FUNCTION "public"."set_room_rent_amount"();



CREATE OR REPLACE TRIGGER "sync_room_occupancy" AFTER INSERT OR DELETE OR UPDATE ON "public"."tenancy" FOR EACH ROW EXECUTE FUNCTION "public"."fn_sync_room_occupancy"();



CREATE OR REPLACE TRIGGER "trg_last_updated" BEFORE UPDATE ON "public"."boarding_house" FOR EACH ROW EXECUTE FUNCTION "public"."fn_last_updated"();



CREATE OR REPLACE TRIGGER "trg_last_updated" BEFORE UPDATE ON "public"."owner_profile" FOR EACH ROW EXECUTE FUNCTION "public"."fn_last_updated"();



CREATE OR REPLACE TRIGGER "trg_last_updated" BEFORE UPDATE ON "public"."rooms" FOR EACH ROW EXECUTE FUNCTION "public"."fn_last_updated"();



CREATE OR REPLACE TRIGGER "trg_last_updated" BEFORE UPDATE ON "public"."tenancy" FOR EACH ROW EXECUTE FUNCTION "public"."fn_last_updated"();



CREATE OR REPLACE TRIGGER "trg_last_updated" BEFORE UPDATE ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."fn_last_updated"();



CREATE OR REPLACE TRIGGER "validate_meter_reading_before_insert" BEFORE INSERT ON "public"."meter_readings" FOR EACH ROW EXECUTE FUNCTION "public"."validate_meter_reading_insert"();



CREATE OR REPLACE TRIGGER "zzz_enforce_explicit_bill_finalization" BEFORE UPDATE OF "billed_at", "electricity_roll_forward_to_bill_id" ON "public"."monthly_bill" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_explicit_bill_finalization"();



ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."monthly_bill"("bill_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_end_reading_id_fkey" FOREIGN KEY ("end_reading_id") REFERENCES "public"."meter_readings"("reading_id");



ALTER TABLE ONLY "public"."bill_items"
    ADD CONSTRAINT "bill_items_start_reading_id_fkey" FOREIGN KEY ("start_reading_id") REFERENCES "public"."meter_readings"("reading_id");



ALTER TABLE ONLY "public"."bill_meter_reading_corrections"
    ADD CONSTRAINT "bill_meter_reading_corrections_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."monthly_bill"("bill_id");



ALTER TABLE ONLY "public"."bill_meter_reading_corrections"
    ADD CONSTRAINT "bill_meter_reading_corrections_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "public"."meter_readings"("reading_id");



ALTER TABLE ONLY "public"."bill_reminders"
    ADD CONSTRAINT "bill_reminders_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."monthly_bill"("bill_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boarding_house"
    ADD CONSTRAINT "boarding_house_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profile"("id");



ALTER TABLE ONLY "public"."device_push_tokens"
    ADD CONSTRAINT "device_push_tokens_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenancy"
    ADD CONSTRAINT "fk_room_id" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("room_id");



ALTER TABLE ONLY "public"."tenancy"
    ADD CONSTRAINT "fk_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id");



ALTER TABLE ONLY "public"."meter_readings"
    ADD CONSTRAINT "meter_readings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("room_id");



ALTER TABLE ONLY "public"."monthly_bill"
    ADD CONSTRAINT "monthly_bill_electricity_roll_forward_to_bill_id_fkey" FOREIGN KEY ("electricity_roll_forward_to_bill_id") REFERENCES "public"."monthly_bill"("bill_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."monthly_bill"
    ADD CONSTRAINT "monthly_bill_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "public"."tenancy"("tenancy_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_related_bill_id_fkey" FOREIGN KEY ("related_bill_id") REFERENCES "public"."monthly_bill"("bill_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_related_room_id_fkey" FOREIGN KEY ("related_room_id") REFERENCES "public"."rooms"("room_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_related_tenancy_id_fkey" FOREIGN KEY ("related_tenancy_id") REFERENCES "public"."tenancy"("tenancy_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."owner_default_charges"
    ADD CONSTRAINT "owner_default_charges_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profile"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."owner_profile"
    ADD CONSTRAINT "owner_profile_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."room_creation_requests"
    ADD CONSTRAINT "room_creation_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("room_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."room_default_charges"
    ADD CONSTRAINT "room_default_charges_rooom_id_fkey" FOREIGN KEY ("rooom_id") REFERENCES "public"."rooms"("room_id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_boarding_house_id_fkey" FOREIGN KEY ("boarding_house_id") REFERENCES "public"."boarding_house"("boarding_house_id");



ALTER TABLE ONLY "public"."tenancy_default_charges"
    ADD CONSTRAINT "tenancy_default_charges_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "public"."tenancy"("tenancy_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenancy"
    ADD CONSTRAINT "tenancy_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profile"("id") ON UPDATE CASCADE ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tenant_archive"
    ADD CONSTRAINT "tenant_archive_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profile"("id");



ALTER TABLE ONLY "public"."tenant_archive"
    ADD CONSTRAINT "tenant_archive_tenancy_id_fkey" FOREIGN KEY ("tenancy_id") REFERENCES "public"."tenancy"("tenancy_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_archive"
    ADD CONSTRAINT "tenant_archive_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profile"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE "private"."bill_reminders_backup_20261121" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Enable delete for users based on user_id" ON "public"."tenants" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."tenants" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Enable users to view their own data only" ON "public"."tenants" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Owners manage their push tokens" ON "public"."device_push_tokens" TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners mark their notifications as read" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("is_read" AND ("read_at" IS NOT NULL)) OR ((NOT "is_read") AND ("read_at" IS NULL)))));



CREATE POLICY "Owners record their room creation requests" ON "public"."room_creation_requests" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM ("public"."rooms" "r"
     JOIN "public"."boarding_house" "bh" ON (("bh"."boarding_house_id" = "r"."boarding_house_id")))
  WHERE (("r"."room_id" = "room_creation_requests"."room_id") AND ("bh"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Owners view their notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners view their room creation requests" ON "public"."room_creation_requests" FOR SELECT TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "authenticated user can view their own rooms" ON "public"."rooms" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."boarding_house"
  WHERE (("boarding_house"."boarding_house_id" = "rooms"."boarding_house_id") AND ("boarding_house"."owner_id" = "auth"."uid"())))));



CREATE POLICY "authenticated users can add their own data" ON "public"."boarding_house" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "authenticated users can delete or remove their own rooms" ON "public"."rooms" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."boarding_house"
  WHERE (("boarding_house"."boarding_house_id" = "rooms"."boarding_house_id") AND ("boarding_house"."owner_id" = "auth"."uid"())))));



CREATE POLICY "authenticated users can delete their own data" ON "public"."boarding_house" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "authenticated users can edit their own dataa" ON "public"."boarding_house" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "authenticated users can edit their own rooms" ON "public"."rooms" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."boarding_house" "bh"
  WHERE (("bh"."boarding_house_id" = "rooms"."boarding_house_id") AND ("bh"."owner_id" = "auth"."uid"())))));



CREATE POLICY "authenticated users can edit their own tenants" ON "public"."tenants" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "authenticated users can insert their own rooms" ON "public"."rooms" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."boarding_house"
  WHERE (("boarding_house"."boarding_house_id" = "rooms"."boarding_house_id") AND ("boarding_house"."owner_id" = "auth"."uid"())))));



CREATE POLICY "authenticated users can view their own data" ON "public"."boarding_house" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."bill_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bill_meter_reading_corrections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bill_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."boarding_house" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."device_push_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meter_readings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_bill" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "owner can add to own archive" ON "public"."tenant_archive" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "owner can view own archive" ON "public"."tenant_archive" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."owner_default_charges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."owner_profile" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "owners add bills" ON "public"."monthly_bill" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."tenancy" "t"
  WHERE (("t"."tenancy_id" = "monthly_bill"."tenancy_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "owners add tenancies for own rooms and tenants" ON "public"."tenancy" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "owner_id") AND (EXISTS ( SELECT 1
   FROM ("public"."rooms" "r"
     JOIN "public"."boarding_house" "bh" ON (("bh"."boarding_house_id" = "r"."boarding_house_id")))
  WHERE (("r"."room_id" = "tenancy"."room_id") AND ("bh"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND (EXISTS ( SELECT 1
   FROM "public"."tenants" "t"
  WHERE (("t"."tenant_id" = "tenancy"."tenant_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "owners insert own meter readings" ON "public"."meter_readings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."rooms" "room"
     JOIN "public"."boarding_house" "house" ON (("house"."boarding_house_id" = "room"."boarding_house_id")))
  WHERE (("room"."room_id" = "meter_readings"."room_id") AND ("house"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "owners insert their bill items" ON "public"."bill_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ((("public"."monthly_bill" "bill"
     JOIN "public"."tenancy" "tenancy" ON (("tenancy"."tenancy_id" = "bill"."tenancy_id")))
     JOIN "public"."rooms" "room" ON (("room"."room_id" = "tenancy"."room_id")))
     JOIN "public"."boarding_house" "house" ON (("house"."boarding_house_id" = "room"."boarding_house_id")))
  WHERE (("bill"."bill_id" = "bill_items"."bill_id") AND ("house"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "owners manage own default charges" ON "public"."owner_default_charges" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "owners manage own tenancy charges" ON "public"."tenancy_default_charges" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."tenancy" "t"
  WHERE (("t"."tenancy_id" = "tenancy_default_charges"."tenancy_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."tenancy" "t"
  WHERE (("t"."tenancy_id" = "tenancy_default_charges"."tenancy_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "owners update bills" ON "public"."monthly_bill" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."tenancy" "t"
  WHERE (("t"."tenancy_id" = "monthly_bill"."tenancy_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."tenancy" "t"
  WHERE (("t"."tenancy_id" = "monthly_bill"."tenancy_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "owners update own tenancies" ON "public"."tenancy" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "owners view bill items for archived roomless tenancies" ON "public"."bill_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."monthly_bill" "bill"
     JOIN "public"."tenancy" "tenancy" ON (("tenancy"."tenancy_id" = "bill"."tenancy_id")))
     JOIN "public"."tenant_archive" "archive" ON (("archive"."tenancy_id" = "tenancy"."tenancy_id")))
  WHERE (("bill"."bill_id" = "bill_items"."bill_id") AND ("tenancy"."room_id" IS NULL) AND ("tenancy"."owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("archive"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "owners view own bill reminders" ON "public"."bill_reminders" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."monthly_bill" "bill"
     JOIN "public"."tenancy" "tenancy" ON (("tenancy"."tenancy_id" = "bill"."tenancy_id")))
  WHERE (("bill"."bill_id" = "bill_reminders"."bill_id") AND ("tenancy"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "owners view own bills" ON "public"."monthly_bill" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."tenancy" "t"
  WHERE (("t"."tenancy_id" = "monthly_bill"."tenancy_id") AND ("t"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "owners view own meter readings" ON "public"."meter_readings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."rooms" "room"
     JOIN "public"."boarding_house" "house" ON (("house"."boarding_house_id" = "room"."boarding_house_id")))
  WHERE (("room"."room_id" = "meter_readings"."room_id") AND ("house"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "owners view own tenancies" ON "public"."tenancy" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "owners view their bill items" ON "public"."bill_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ((("public"."monthly_bill" "bill"
     JOIN "public"."tenancy" "tenancy" ON (("tenancy"."tenancy_id" = "bill"."tenancy_id")))
     JOIN "public"."rooms" "room" ON (("room"."room_id" = "tenancy"."room_id")))
     JOIN "public"."boarding_house" "house" ON (("house"."boarding_house_id" = "room"."boarding_house_id")))
  WHERE (("bill"."bill_id" = "bill_items"."bill_id") AND ("house"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."room_creation_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."room_default_charges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenancy" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenancy_default_charges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_archive" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user can edit user information" ON "public"."owner_profile" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "user can view own profile" ON "public"."owner_profile" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "service_role";















































































































































































































REVOKE ALL ON FUNCTION "private"."build_bill_email_payload"("p_bill_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."build_bill_email_payload"("p_bill_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "private"."create_bill_due_notifications"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."dispatch_notification_push"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."enqueue_notification"("p_owner_id" "uuid", "p_event_key" "text", "p_type" "text", "p_title" "text", "p_message" "text", "p_related_record_type" "text", "p_related_record_id" "uuid", "p_data" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."notify_electricity_charge"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."notify_monthly_bill_changes"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."notify_tenancy_changes"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."tenant_document_is_referenced"("p_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."tenant_document_is_referenced"("p_path" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."archive_tenancy"("p_tenancy_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_tenancy"("p_tenancy_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_tenancy"("p_tenancy_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."archive_tenancy_with_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text", "p_reading_value" numeric, "p_reading_at" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_tenancy_with_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text", "p_reading_value" numeric, "p_reading_at" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_tenancy_with_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text", "p_reading_value" numeric, "p_reading_at" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_archive_tenancy"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_archive_tenancy"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."block_finalized_bill_edit"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."cancel_bill_electricity_roll_forward"("p_source_bill_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_bill_electricity_roll_forward"("p_source_bill_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_bill_electricity_roll_forward"("p_source_bill_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."carry_forward_bill_electricity"("p_source_bill_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."carry_forward_bill_electricity"("p_source_bill_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."carry_forward_bill_electricity"("p_source_bill_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "postgres";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "anon";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_tenant_bill_resend"("p_bill_id" "uuid", "p_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_tenant_bill_resend"("p_bill_id" "uuid", "p_request_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_tenant_bill_resend"("p_bill_id" "uuid", "p_request_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."correct_bill_meter_reading"("p_bill_id" "uuid", "p_new_reading_value" numeric, "p_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."correct_bill_meter_reading"("p_bill_id" "uuid", "p_new_reading_value" numeric, "p_request_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_room_with_meter_reading"("p_boarding_house_id" "uuid", "p_room_name" "text", "p_monthly_rate" numeric, "p_request_id" "text", "p_initial_reading_value" numeric, "p_initial_reading_at" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_room_with_meter_reading"("p_boarding_house_id" "uuid", "p_room_name" "text", "p_monthly_rate" numeric, "p_request_id" "text", "p_initial_reading_value" numeric, "p_initial_reading_at" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_room_with_meter_reading"("p_boarding_house_id" "uuid", "p_room_name" "text", "p_monthly_rate" numeric, "p_request_id" "text", "p_initial_reading_value" numeric, "p_initial_reading_at" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."cycle_date"("p_anchor" "date", "p_month" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."cycle_date"("p_anchor" "date", "p_month" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cycle_date"("p_anchor" "date", "p_month" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "postgres";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "anon";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_boarding_houses"("p_boarding_house_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_boarding_houses"("p_boarding_house_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_boarding_houses"("p_boarding_house_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_rooms_with_tenant_archive"("p_boarding_house_id" "uuid", "p_room_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_rooms_with_tenant_archive"("p_boarding_house_id" "uuid", "p_room_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_rooms_with_tenant_archive"("p_boarding_house_id" "uuid", "p_room_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."edit_room_with_rent_sync"("p_room_id" "uuid", "p_room_name" "text", "p_monthly_rate" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."edit_room_with_rent_sync"("p_room_id" "uuid", "p_room_name" "text", "p_monthly_rate" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."edit_room_with_rent_sync"("p_room_id" "uuid", "p_room_name" "text", "p_monthly_rate" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_explicit_bill_finalization"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_explicit_bill_finalization"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_tenant_bill"("p_bill_id" "uuid", "p_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_tenant_bill"("p_bill_id" "uuid", "p_request_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_tenant_bill"("p_bill_id" "uuid", "p_request_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "postgres";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "anon";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "service_role";



GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_last_updated"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_last_updated"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_last_updated"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_sync_room_occupancy"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_sync_room_occupancy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_sync_room_occupancy"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_due_bills"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_due_bills"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_due_bills"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_monthly_bill"("p_tenancy_id" "uuid", "p_period_start" "date", "p_period_end" "date", "p_due_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_monthly_bill"("p_tenancy_id" "uuid", "p_period_start" "date", "p_period_end" "date", "p_due_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_monthly_bill"("p_tenancy_id" "uuid", "p_period_start" "date", "p_period_end" "date", "p_due_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_bill_electricity_context"("p_bill_id" "uuid", "p_reading_at" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_bill_electricity_context"("p_bill_id" "uuid", "p_reading_at" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bill_electricity_context"("p_bill_id" "uuid", "p_reading_at" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_bill_meter_reading_correction_context"("p_bill_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_bill_meter_reading_correction_context"("p_bill_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bill_meter_reading_correction_context"("p_bill_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_tenant_list"("p_tab" "text", "p_search" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_tenant_list"("p_tab" "text", "p_search" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_tenant_list"("p_tab" "text", "p_search" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."guard_electricity_roll_forward"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_electricity_roll_forward"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_electricity_roll_forward"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_final_move_out_no_charge"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "postgres";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "postgres";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "postgres";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "anon";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "postgres";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "anon";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."preview_tenant_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text", "p_reading_value" numeric, "p_reading_at" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."preview_tenant_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text", "p_reading_value" numeric, "p_reading_at" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."preview_tenant_move_out"("p_tenancy_id" "uuid", "p_move_out_date" "date", "p_electricity_option" "text", "p_reading_value" numeric, "p_reading_at" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."recalc_bill_total"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."record_bill_electricity_reading"("p_bill_id" "uuid", "p_reading_value" numeric, "p_reading_at" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_bill_electricity_reading"("p_bill_id" "uuid", "p_reading_value" numeric, "p_reading_at" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_bill_electricity_reading"("p_bill_id" "uuid", "p_reading_value" numeric, "p_reading_at" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_tenancy_statuses"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_tenancy_statuses"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_tenancy_statuses"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_tenancy"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_tenancy"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_tenancy"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_tenancy_with_opening_reading"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb", "p_opening_reading_value" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_tenancy_with_opening_reading"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb", "p_opening_reading_value" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_tenancy_with_opening_reading"("p_room_id" "uuid", "p_name" "text", "p_contact_number" "text", "p_email_address" "text", "p_id_photo_url" "text", "p_agreement_photo_url" "text", "p_move_in_date" "date", "p_custom_charges" "jsonb", "p_opening_reading_value" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_tenant_documents"("p_tenant_id" "uuid", "p_action" "text", "p_archived_id_path" "text", "p_archived_agree_path" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_tenant_documents"("p_tenant_id" "uuid", "p_action" "text", "p_archived_id_path" "text", "p_archived_agree_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_tenant_documents"("p_tenant_id" "uuid", "p_action" "text", "p_archived_id_path" "text", "p_archived_agree_path" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_tenant_list"("p_status" "text", "p_search" "text", "p_offset" integer, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_tenant_list"("p_status" "text", "p_search" "text", "p_offset" integer, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_tenant_list"("p_status" "text", "p_search" "text", "p_offset" integer, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_electricity_quantity"() FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."set_room_rent_amount"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_room_rent_amount"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_room_rent_amount"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_tenancy_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_tenancy_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_tenancy_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_meter_reading_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_meter_reading_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_meter_reading_insert"() TO "service_role";






























GRANT ALL ON TABLE "public"."bill_items" TO "anon";
GRANT ALL ON TABLE "public"."bill_items" TO "authenticated";
GRANT ALL ON TABLE "public"."bill_items" TO "service_role";



GRANT ALL ON TABLE "public"."bill_meter_reading_corrections" TO "service_role";



GRANT ALL ON TABLE "public"."bill_reminders" TO "service_role";
GRANT SELECT ON TABLE "public"."bill_reminders" TO "authenticated";



GRANT ALL ON TABLE "public"."boarding_house" TO "anon";
GRANT ALL ON TABLE "public"."boarding_house" TO "authenticated";
GRANT ALL ON TABLE "public"."boarding_house" TO "service_role";



GRANT ALL ON TABLE "public"."device_push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."device_push_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."meter_readings" TO "anon";
GRANT ALL ON TABLE "public"."meter_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."meter_readings" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_bill" TO "anon";
GRANT ALL ON TABLE "public"."monthly_bill" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_bill" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT UPDATE("is_read") ON TABLE "public"."notifications" TO "authenticated";



GRANT UPDATE("read_at") ON TABLE "public"."notifications" TO "authenticated";



GRANT ALL ON TABLE "public"."owner_default_charges" TO "anon";
GRANT ALL ON TABLE "public"."owner_default_charges" TO "authenticated";
GRANT ALL ON TABLE "public"."owner_default_charges" TO "service_role";



GRANT ALL ON TABLE "public"."owner_profile" TO "anon";
GRANT ALL ON TABLE "public"."owner_profile" TO "authenticated";
GRANT ALL ON TABLE "public"."owner_profile" TO "service_role";



GRANT ALL ON TABLE "public"."room_creation_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."room_creation_requests" TO "service_role";



GRANT ALL ON TABLE "public"."room_default_charges" TO "anon";
GRANT ALL ON TABLE "public"."room_default_charges" TO "authenticated";
GRANT ALL ON TABLE "public"."room_default_charges" TO "service_role";



GRANT ALL ON TABLE "public"."rooms" TO "anon";
GRANT ALL ON TABLE "public"."rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."rooms" TO "service_role";



GRANT ALL ON TABLE "public"."tenancy" TO "anon";
GRANT ALL ON TABLE "public"."tenancy" TO "authenticated";
GRANT ALL ON TABLE "public"."tenancy" TO "service_role";



GRANT ALL ON TABLE "public"."tenancy_default_charges" TO "authenticated";
GRANT ALL ON TABLE "public"."tenancy_default_charges" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tenancy_default_charges" TO "anon";



GRANT ALL ON TABLE "public"."tenant_archive" TO "anon";
GRANT ALL ON TABLE "public"."tenant_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_archive" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































