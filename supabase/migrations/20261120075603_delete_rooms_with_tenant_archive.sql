-- Detached tenancies retain their bills, but the original bill-item policy
-- requires a room. Grant read access only to the owner's archived history.
CREATE POLICY "owners view bill items for archived roomless tenancies"
ON public.bill_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.monthly_bill AS bill
    JOIN public.tenancy AS tenancy ON tenancy.tenancy_id = bill.tenancy_id
    JOIN public.tenant_archive AS archive ON archive.tenancy_id = tenancy.tenancy_id
    WHERE bill.bill_id = bill_items.bill_id
      AND tenancy.room_id IS NULL
      AND tenancy.owner_id = (SELECT auth.uid())
      AND archive.owner_id = (SELECT auth.uid())
  )
);

-- Tenancy updates are intentionally restricted to existing privileged workflows.
-- Authorize every selected room and affected tenant before modifying any data.
CREATE FUNCTION public.delete_rooms_with_tenant_archive(p_boarding_house_id uuid, p_room_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.delete_rooms_with_tenant_archive(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_rooms_with_tenant_archive(uuid, uuid[]) TO authenticated;