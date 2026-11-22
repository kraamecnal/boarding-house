CREATE OR REPLACE FUNCTION public.search_tenant_list(
  p_status text,
  p_search text DEFAULT '',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  record_id uuid,
  tenant_name text,
  room_name text,
  boarding_house_name text,
  room_id uuid,
  boarding_house_id uuid,
  move_in_date date,
  move_out_date date,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.search_tenant_list(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_tenant_list(text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_tenant_list(text, text, integer, integer) TO authenticated;