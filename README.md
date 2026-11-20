# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Supabase email OTP authentication

1. Create a Supabase project and copy its Project URL and publishable key from the project API settings.
2. Copy `.env.example` to `.env` and replace the example values:

   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
   ```

   The local `.env` file is ignored by Git. Restart Expo after changing environment variables:

   ```bash
   npx expo start --clear
   ```

3. In Supabase **Authentication → Email Templates**, configure numerical codes rather than confirmation links. In the **Magic Link** template, replace the confirmation link with a displayed code, for example:

   ```html
   <p>Your InKeeper verification code is: <strong>{{ .Token }}</strong></p>
   ```

   If sign-up confirmation is enabled, make the same change to the **Confirm signup** template. Do not include an OTP in a URL or log it. The app verifies the submitted code with Supabase; it does not use a redirect callback to sign in.
4. For payment-password recovery, configure the **Reset Password** authentication email template (called **Change Password** in some dashboard views) to show `{{ .Token }}` as the six-digit code, with copy explaining that it resets the InKeeper payment password. Do not use only `{{ .ConfirmationURL }}` or the separate **Password changed** notification template. The local project uses `supabase/templates/recovery.html` for this template; changing local files does not update a hosted project.
5. In **Authentication → Sign In / Providers → Email**, confirm email authentication is enabled and set **Email OTP Length** to `6`. This is a hosted-project setting; `supabase/config.toml` also sets `auth.email.otp_length = 6` for local Supabase development, but changing that file does not update the hosted project. Review the **Email OTP expiration** and email rate-limit settings as well. The app applies a 60-second recovery-code resend cooldown. Sign In requests do not create users; Sign Up requests allow Supabase to create an unconfirmed user. Supabase uses the `email` verification type for both flows.
6. Test Sign Up with an unused email, enter the received code in the app, and confirm the app opens its authenticated screen. Sign out and repeat with an existing account in Sign In mode. Incorrect and expired codes should show an error without clearing the entered code.

The existing payment-password flow stores the payment password as the user's Supabase Auth account password. Email OTP is the app's sign-in flow, but resetting the payment password also changes that account password. Recovery verifies a `recovery` OTP in a non-persistent client and updates the password only when the verified user matches the signed-in user.

Only use the Supabase publishable key in the app. Never put a secret or service-role key in an `EXPO_PUBLIC_` variable or in client code.

Email OTP authentication is implemented in the app, but it is not confirmed operational until the Supabase email templates are configured to send numerical codes and both flows are tested. Boarding houses, rooms, tenants, tenancies, and monthly bills are stored in Supabase.

The migrations in `supabase/migrations/` add tenancy-specific charge overrides and the private `tenant-documents` bucket. Link the Supabase CLI to the intended project and apply pending migrations in order before registering tenants. The bucket accepts JPEG, PNG, and WebP files up to 5 MB. Its Storage policies validate room ownership through `rooms` and `boarding_house`, and read access requires a matching document path in the owner's tenant, tenancy, or archive record. A non-exposed `private` helper checks references across all owners before deletion because normal RLS queries cannot see other owners' rows. The previous private `Tenant_documents` bucket remains available for referenced legacy and archived documents; only unreferenced objects owned by the signed-in user can be removed.

Tenant document paths are saved in `tenants.id_photo_url` and `tenancy.agreement_photo_url`. The app uses short-lived signed URLs for viewing; it never stores those URLs or uses a service-role key. Camera access is configured through the Expo Image Picker plugin, so rebuild native development clients after changing the permission configuration.

Apply the `delete_rooms_with_tenant_archive` migration before using Rooms delete mode. It archives affected tenancies and document paths before deleting rooms, preserves their bills and meter readings, and restores owner-only access to archived bill items after a room is removed.
To exercise the rollback-only regression fixtures, apply the migration to an isolated test database with the existing schema, then run `supabase db query --file supabase\tests\delete_rooms_with_tenant_archive.sql` against that database.

Rooms have a permanent monthly meter-reading day (default 15; days beyond a month’s length use that month’s final day). Record the move-in reading on the tenant’s move-in date and a closing reading when ending a tenancy. Scheduled present readings are entered from the Monthly Bill; the database saves the reading and electricity bill item together, using the tenancy rate first and the owner default second. A missing move-in reading or rate never creates an estimated charge. Tenancy boundary readings are required before a tenancy can end, preventing usage from being assigned to a different tenant. Existing manual electricity items and finalized bills remain unchanged. Apply `meter_readings_workflow` and then `automatic_meter_billing` in order before using the updated room, tenant, or billing screens.

The Manage tab shows the dashboard summary. Open the gear menu to visit Billing charges or Profile; the Profile page links to the About and Version information.

## Notifications

The Manage tab's existing bell opens the owner's notification history. In-app entries are created from database events, are scoped to the signed-in owner by RLS, and update through Supabase Realtime. A daily Manila-time `pg_cron` job creates the two-day and due-today bill reminders. Event keys make trigger and scheduled-job inserts idempotent. Electricity charges continue to use the existing meter-reading and rate calculation; notifications only report that workflow.

Apply the new migration after reviewing it, then deploy the push function:

```sh
npx supabase db push
npx supabase functions deploy send-notification-push --project-ref <project-ref>
```

Push delivery requires a development or production native build, granted notification permission, and valid Expo/EAS push credentials for the project. Android remote push is not supported in Expo Go; use a development build to enable it. The app skips push-token/channel initialization in Expo Go while keeping in-app notifications and Realtime updates available, and exposes the limitation in Settings. Push is optional: the notification list and Realtime updates still work when a device has not granted permission. The Edge Function uses the server-side Supabase service-role key and Expo Push Service; neither key nor push credentials belong in the app.

To enable secure database-to-function dispatch, create one random webhook secret and set it as an Edge Function secret:

```sh
npx supabase secrets set NOTIFICATION_WEBHOOK_SECRET=<random-secret> --project-ref <project-ref>
```

Store the same secret and the project URL in Supabase Vault (run once in the SQL editor, substituting the actual values):

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'notifications_supabase_url');
select vault.create_secret('<random-secret>', 'notifications_webhook_secret');
```

The database queues push requests asynchronously through `pg_net`, so a push-service outage does not roll back a bill, tenancy, or notification.

### Tenant email reminders

The existing `send-bill-reminders-daily` cron job invokes the server-only `send-bill-reminders` Edge Function. Apply the `bill_reminder_delivery_tracking` migration before deploying the function. The migration adds delivery/attempt state to the existing `bill_reminders` table and updates that same cron job to run hourly; the function only processes unpaid bills due today or in two days (Manila time), so hourly runs provide same-day retry opportunities without creating another schedule. A unique bill/type key and an atomic claim prevent concurrent duplicate sends. Successful Brevo acceptance is recorded as `sent`; rejected requests remain failed, and requests whose outcome is ambiguous are marked `uncertain` and are not automatically resent.

Push the migration, then set the following Edge Function secrets in the target Supabase project. Do not put their values in app code or commit them:

```sh
npx supabase db push --project-ref <project-ref>
npx supabase secrets set BREVO_API_KEY=<brevo-api-key> BREVO_SENDER_EMAIL=<verified-sender-email> --project-ref <project-ref>
npx supabase functions deploy send-bill-reminders --project-ref <project-ref>
```

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the server runtime. The function requires a verified service-role JWT, accepts no bill ID from callers, and must remain configured with `verify_jwt = true`. The cron job uses its existing server-side service-role authorization. For local checks, run `deno test supabase/functions/send-bill-reminders/reminder-logic_test.ts`; do not test delivery by calling the live function with real tenant bills. Use a developer-approved controlled recipient for any end-to-end email test.

### Notification checks

After applying the migration and configuring push:

1. Sign in as an owner and open Manage. Confirm the bell opens the list, shows an empty state when appropriate, and asks for push permission only after choosing **Enable push alerts**.
2. Register a tenant, generate a bill, add its electricity reading, and mark the bill paid. Confirm the corresponding tenant, bill, reading-required, electricity-charge, and paid notifications appear without refreshing.
3. Use a bill due in two days and another due today to check the scheduled reminders. Run `select private.create_bill_due_notifications();` twice in the SQL editor and confirm each bill has only one reminder of each type.
4. Mark one notification read and then mark all read. Confirm the unread badge and read styling update immediately and remain correct after reopening Manage.
5. Sign in as a second owner and attempt to query/update the first owner's notification ID; RLS must return no row and prevent changes.
6. Retry the reminder function and repeat event-producing actions where safe. Confirm the `(owner_id, event_key)` uniqueness prevents duplicates.
7. Disable or invalidate a device push token and verify in-app notification creation still succeeds. Check Edge Function logs for delivery errors; push failures must not interrupt the primary workflow.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.