-- Lets the owner archive (move out) their current tenant from the app.
--
-- The app can no longer update `tenancy` directly (the "owners update own
-- tenancies" policy was dropped in 20261029160433), so archiving goes through
-- this function. It only sets move_out_date; the existing triggers do the rest:
--   derive_tenancy_status    -> status becomes 'ended'
--   auto_archive_on_move_out -> copies the tenant into public.tenant_archive
--   sync_room_occupancy      -> rooms.is_occupied becomes false (room is vacant)
-- Bills stay attached to the ended tenancy, so a new tenant starts clean.

CREATE OR REPLACE FUNCTION public.archive_tenancy(p_tenancy_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_owner_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_tenancy public.tenancy%ROWTYPE;
  v_archive_id uuid;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT * INTO v_tenancy
  FROM public.tenancy
  WHERE tenancy_id = p_tenancy_id
    AND owner_id = v_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenancy not found or not authorized';
  END IF;

  IF v_tenancy.status <> 'active' OR v_tenancy.move_out_date IS NOT NULL THEN
    RAISE EXCEPTION 'Only a current tenant can be archived';
  END IF;

  UPDATE public.tenancy
  SET move_out_date = greatest(v_today, v_tenancy.move_in_date)
  WHERE tenancy_id = p_tenancy_id;

  SELECT archive_id INTO v_archive_id
  FROM public.tenant_archive
  WHERE tenancy_id = p_tenancy_id;

  -- Roll everything back if the archive row was not created.
  IF v_archive_id IS NULL THEN
    RAISE EXCEPTION 'The tenant could not be archived';
  END IF;

  RETURN v_archive_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_tenancy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_tenancy(uuid) TO authenticated, service_role;