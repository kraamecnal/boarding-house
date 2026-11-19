-- Keep tenant and bill history while removing its former room association.
ALTER TABLE public.tenancy
  ALTER COLUMN room_id DROP NOT NULL;

ALTER TABLE public.meter_readings
  ALTER COLUMN room_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.set_tenancy_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_boarding_houses(p_boarding_house_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.delete_boarding_houses(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_boarding_houses(uuid[]) TO authenticated;