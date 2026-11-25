SET local check_function_bodies = off;

REVOKE ALL ON FUNCTION "public"."archive_tenancy"(uuid) FROM "anon";

REVOKE ALL ON FUNCTION "public"."archive_tenancy_with_move_out"(uuid, date, text, numeric, date) FROM "anon";

REVOKE ALL ON FUNCTION "public"."auto_archive_tenancy"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."auto_archive_tenancy"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."block_finalized_bill_edit"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."block_finalized_bill_edit"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."block_finalized_bill_edit"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."cancel_bill_electricity_roll_forward"(uuid) FROM "anon";

REVOKE ALL ON FUNCTION "public"."carry_forward_bill_electricity"(uuid) FROM "anon";

REVOKE ALL ON FUNCTION "public"."claim_tenant_bill_resend"(uuid, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."correct_bill_meter_reading"(uuid, numeric, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."correct_bill_meter_reading"(uuid, numeric, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."create_room_with_meter_reading"(uuid, text, numeric, text, numeric, date) FROM "anon";

REVOKE ALL ON FUNCTION "public"."delete_boarding_houses"(uuid[]) FROM "anon";

REVOKE ALL ON FUNCTION "public"."delete_rooms_with_tenant_archive"(uuid, uuid[]) FROM "anon";

REVOKE ALL ON FUNCTION "public"."edit_room_with_rent_sync"(uuid, text, numeric) FROM "anon";

REVOKE ALL ON FUNCTION "public"."enforce_explicit_bill_finalization"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."enforce_explicit_bill_finalization"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."finalize_tenant_bill"(uuid, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."get_bill_electricity_context"(uuid, date) FROM "anon";

REVOKE ALL ON FUNCTION "public"."get_bill_meter_reading_correction_context"(uuid) FROM "anon";

REVOKE ALL ON FUNCTION "public"."get_tenant_list"(text, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."guard_final_move_out_no_charge"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."guard_final_move_out_no_charge"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."guard_final_move_out_no_charge"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."preview_tenant_move_out"(uuid, date, text, numeric, date) FROM "anon";

REVOKE ALL ON FUNCTION "public"."recalc_bill_total"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."recalc_bill_total"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."recalc_bill_total"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."record_bill_electricity_reading"(uuid, numeric, date) FROM "anon";

REVOKE ALL ON FUNCTION "public"."register_tenancy"(uuid, text, text, text, text, text, date, jsonb) FROM "anon";

REVOKE ALL ON FUNCTION "public"."register_tenancy_with_opening_reading"(uuid, text, text, text, text, text, date, jsonb, numeric) FROM "anon";

REVOKE ALL ON FUNCTION "public"."search_tenant_list"(text, text, integer, integer) FROM "anon";

REVOKE ALL ON FUNCTION "public"."set_electricity_quantity"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."set_electricity_quantity"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."set_electricity_quantity"() FROM "service_role";

REVOKE ALL ON TABLE "public"."bill_meter_reading_corrections" FROM "anon";

REVOKE ALL ON TABLE "public"."bill_meter_reading_corrections" FROM "authenticated";

REVOKE ALL ON TABLE "public"."bill_reminders" FROM "anon";

REVOKE ALL ON TABLE "public"."device_push_tokens" FROM "anon";

REVOKE ALL ON TABLE "public"."notifications" FROM "anon";

REVOKE ALL ON TABLE "public"."room_creation_requests" FROM "anon";

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY "owners delete unreferenced tenant documents for own rooms" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING
    (((bucket_id = 'tenant-documents'::text) AND (array_length(storage.foldername(name), 1) = 4) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND
    ((storage.foldername(name))[3] ~ '^[a-z0-9-]{10,80}$'::text) AND ((storage.foldername(name))[4] = ANY (ARRAY['id'::text, 'agreement'::text])) AND (EXISTS ( SELECT 1
   FROM (public.rooms room
     JOIN public.boarding_house house ON ((house.boarding_house_id = room.boarding_house_id)))
  WHERE (((room.room_id)::text = (storage.foldername(objects.name))[2]) AND (house.owner_id = ( SELECT auth.uid() AS uid))))) AND
    (NOT private.tenant_document_is_referenced(name))));

CREATE POLICY "owners read referenced tenant documents" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING
    (((bucket_id = 'tenant-documents'::text) AND (array_length(storage.foldername(name), 1) = 4) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND
    ((((storage.foldername(name))[4] = 'id'::text) AND (EXISTS ( SELECT 1
   FROM public.tenants tenant
  WHERE ((tenant.owner_id = ( SELECT auth.uid() AS uid)) AND (tenant.id_photo_url = objects.name))))) OR (((storage.foldername(name))[4] = 'agreement'::text) AND (EXISTS ( SELECT 1
   FROM public.tenancy tenancy
  WHERE ((tenancy.owner_id = ( SELECT auth.uid() AS uid)) AND (tenancy.agreement_photo_url = objects.name))))) OR (EXISTS ( SELECT 1
   FROM public.tenant_archive archive
  WHERE ((archive.owner_id = ( SELECT auth.uid() AS uid)) AND ((archive.id_photo_path = objects.name) OR (archive.agreement_photo_path = objects.name))))))));

CREATE POLICY "owners upload tenant documents for own rooms" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((bucket_id = 'tenant-documents'::text) AND (array_length(storage.foldername(name), 1) = 4) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND
    ((storage.foldername(name))[3] ~ '^[a-z0-9-]{10,80}$'::text) AND ((storage.foldername(name))[4] = ANY (ARRAY['id'::text, 'agreement'::text])) AND
    (split_part(name, '/'::text, 5) ~* '^[a-z0-9-]+\.(jpe?g|png|webp)$'::text) AND (EXISTS ( SELECT 1
   FROM (public.rooms room
     JOIN public.boarding_house house ON ((house.boarding_house_id = room.boarding_house_id)))
  WHERE (((room.room_id)::text = (storage.foldername(objects.name))[2]) AND (house.owner_id = ( SELECT auth.uid() AS uid)))))));

CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();

REVOKE ALL ON TABLE "public"."bill_reminders" FROM "authenticated";

GRANT SELECT ON TABLE "public"."bill_reminders" TO "authenticated";

SELECT cron.schedule_in_database('daily-tenant-bill-emails', '0 0 * * *', '
  select
    net.http_post(
      url := ''https://zsnwidizzfgakbvtarvn.supabase.co/functions/v1/send-tenant-bill-emails'',
      headers := ''{"Content-Type": "application/json",
        "Authorization":
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzbndpZGl6emZnYWtidnRhcnZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzYyNTAsImV4cCI6MjEwMzE1MjI1MH0.8WI--q-foGe50jl3_88wp02uZajt0UDLl2-0UnNJKbk"}''::jsonb,
      body := ''{}''::jsonb
    ) as request_id;
  ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('generate-monthly-bills', '5 16 * * *', 'select public.generate_due_bills();', 'postgres', NULL, true);

SELECT cron.schedule_in_database('refresh-tenancy-statuses', '0 16 * * *', ' select public.refresh_tenancy_statuses(); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('send-bill-reminders-daily', '0 0 * * *', '
      SELECT net.http_post(
        url := ''https://zsnwidizzfgakbvtarvn.functions.supabase.co/send-bill-reminders'',
        headers := jsonb_build_object(
          ''Content-Type'', ''application/json'',
          ''x-bill-reminders-cron-token'',
          (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = ''bill_reminders_cron_token''
          )
        ),
        body := ''{}''::jsonb,
        timeout_milliseconds := 30000
      );
    ', 'postgres', NULL, true);
