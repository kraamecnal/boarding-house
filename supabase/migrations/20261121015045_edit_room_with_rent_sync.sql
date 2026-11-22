CREATE FUNCTION public.edit_room_with_rent_sync(
  p_room_id uuid,
  p_room_name text DEFAULT NULL,
  p_monthly_rate numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.edit_room_with_rent_sync(uuid, text, numeric)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_room_with_rent_sync(uuid, text, numeric)
TO authenticated;