INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'tenant-documents',
  'tenant-documents',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE INDEX IF NOT EXISTS tenants_owner_id_photo_url_idx
  ON public.tenants (id_photo_url, owner_id)
  WHERE id_photo_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenancy_owner_agreement_photo_url_idx
  ON public.tenancy (agreement_photo_url, owner_id)
  WHERE agreement_photo_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_archive_owner_id_photo_path_idx
  ON public.tenant_archive (id_photo_path, owner_id)
  WHERE id_photo_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_archive_owner_agreement_photo_path_idx
  ON public.tenant_archive (agreement_photo_path, owner_id)
  WHERE agreement_photo_path IS NOT NULL;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.tenant_document_is_referenced(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION private.tenant_document_is_referenced(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.tenant_document_is_referenced(text) TO authenticated;

DROP POLICY IF EXISTS "owners access own files" ON storage.objects;

CREATE POLICY "owners read referenced legacy tenant documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'Tenant_documents'
    AND (
      EXISTS (
        SELECT 1
        FROM public.tenants tenant
        WHERE tenant.owner_id = (SELECT auth.uid())
          AND tenant.id_photo_url = storage.objects.name
      )
      OR EXISTS (
        SELECT 1
        FROM public.tenancy tenancy
        WHERE tenancy.owner_id = (SELECT auth.uid())
          AND tenancy.agreement_photo_url = storage.objects.name
      )
      OR EXISTS (
        SELECT 1
        FROM public.tenant_archive archive
        WHERE archive.owner_id = (SELECT auth.uid())
          AND (
            archive.id_photo_path = storage.objects.name
            OR archive.agreement_photo_path = storage.objects.name
          )
      )
    )
  );

CREATE POLICY "owners delete unreferenced legacy tenant documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'Tenant_documents'
    AND owner = (SELECT auth.uid())
    AND NOT private.tenant_document_is_referenced(storage.objects.name)
  );

CREATE POLICY "owners read referenced tenant documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'tenant-documents'
    AND array_length(storage.foldername(name), 1) = 4
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (
      (
        (storage.foldername(name))[4] = 'id'
        AND EXISTS (
          SELECT 1
          FROM public.tenants tenant
          WHERE tenant.owner_id = (SELECT auth.uid())
            AND tenant.id_photo_url = storage.objects.name
        )
      )
      OR (
        (storage.foldername(name))[4] = 'agreement'
        AND EXISTS (
          SELECT 1
          FROM public.tenancy tenancy
          WHERE tenancy.owner_id = (SELECT auth.uid())
            AND tenancy.agreement_photo_url = storage.objects.name
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.tenant_archive archive
        WHERE archive.owner_id = (SELECT auth.uid())
          AND (
            archive.id_photo_path = storage.objects.name
            OR archive.agreement_photo_path = storage.objects.name
          )
      )
    )
  );

CREATE POLICY "owners upload tenant documents for own rooms"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-documents'
    AND array_length(storage.foldername(name), 1) = 4
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[3] ~ '^[a-z0-9-]{10,80}$'
    AND (storage.foldername(name))[4] IN ('id', 'agreement')
    AND split_part(name, '/', 5) ~* '^[a-z0-9-]+\.(jpe?g|png|webp)$'
    AND EXISTS (
      SELECT 1
      FROM public.rooms room
      JOIN public.boarding_house house
        ON house.boarding_house_id = room.boarding_house_id
      WHERE room.room_id::text = (storage.foldername(name))[2]
        AND house.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "owners delete unreferenced tenant documents for own rooms"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'tenant-documents'
    AND array_length(storage.foldername(name), 1) = 4
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[3] ~ '^[a-z0-9-]{10,80}$'
    AND (storage.foldername(name))[4] IN ('id', 'agreement')
    AND EXISTS (
      SELECT 1
      FROM public.rooms room
      JOIN public.boarding_house house
        ON house.boarding_house_id = room.boarding_house_id
      WHERE room.room_id::text = (storage.foldername(name))[2]
        AND house.owner_id = (SELECT auth.uid())
    )
    AND NOT private.tenant_document_is_referenced(storage.objects.name)
  );