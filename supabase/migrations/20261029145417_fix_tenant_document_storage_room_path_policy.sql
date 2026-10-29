DROP POLICY IF EXISTS "owners upload tenant documents for own rooms" ON storage.objects;
DROP POLICY IF EXISTS "owners delete unreferenced tenant documents for own rooms" ON storage.objects;

CREATE POLICY "owners upload tenant documents for own rooms"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-documents'
    AND array_length(storage.foldername(storage.objects.name), 1) = 4
    AND (storage.foldername(storage.objects.name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(storage.objects.name))[3] ~ '^[a-z0-9-]{10,80}$'
    AND (storage.foldername(storage.objects.name))[4] IN ('id', 'agreement')
    AND split_part(storage.objects.name, '/', 5) ~* '^[a-z0-9-]+\.(jpe?g|png|webp)$'
    AND EXISTS (
      SELECT 1
      FROM public.rooms room
      JOIN public.boarding_house house
        ON house.boarding_house_id = room.boarding_house_id
      WHERE room.room_id::text = (storage.foldername(storage.objects.name))[2]
        AND house.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "owners delete unreferenced tenant documents for own rooms"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'tenant-documents'
    AND array_length(storage.foldername(storage.objects.name), 1) = 4
    AND (storage.foldername(storage.objects.name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(storage.objects.name))[3] ~ '^[a-z0-9-]{10,80}$'
    AND (storage.foldername(storage.objects.name))[4] IN ('id', 'agreement')
    AND EXISTS (
      SELECT 1
      FROM public.rooms room
      JOIN public.boarding_house house
        ON house.boarding_house_id = room.boarding_house_id
      WHERE room.room_id::text = (storage.foldername(storage.objects.name))[2]
        AND house.owner_id = (SELECT auth.uid())
    )
    AND NOT private.tenant_document_is_referenced(storage.objects.name)
  );
