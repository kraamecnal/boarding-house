BEGIN;

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
$function$;

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
$function$;

REVOKE ALL ON FUNCTION private.notify_monthly_bill_changes()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_tenancy_changes()
  FROM PUBLIC, anon, authenticated;

COMMIT;