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

The Manage tab shows the dashboard summary. Open the gear menu to visit Billing Charges, Profile, Tenants, or Settings. Settings is a normal screen, so Android's back action returns to Manage. The drawer shows the installed app version at its bottom. Open About InKeeper from Settings to read the app's About information.

## Notifications

The Manage tab's existing bell opens the owner's notification history. In-app entries are created from database events, are scoped to the signed-in owner by RLS, and update through Supabase Realtime. A daily Manila-time `pg_cron` job creates the two-day and due-today bill reminders. Event keys make trigger and scheduled-job inserts idempotent. Electricity charges continue to use the existing meter-reading and rate calculation; notifications only report that workflow.

Apply the new migration after reviewing it, then deploy the push function:

```sh
npx supabase db push
npx supabase functions deploy send-notification-push --project-ref <project-ref>
```

Push delivery requires a development or production native build, granted notification permission, and valid Expo/EAS push credentials for the project. Android remote push is not supported in Expo Go; use a development build to enable it. The app skips push-token/channel initialization in Expo Go while keeping in-app notifications and Realtime updates available, and exposes the limitation in Settings. Push is optional: the notification list and Realtime updates still work when a device has not granted permission. The Edge Function uses the server-side Supabase service-role key and Expo Push Service; neither key nor push credentials belong in the app.

Settings reads Android permission and checks this phone's token in `device_push_tokens` before showing the switch as on. Permission is requested only after the owner turns on **Enable push alerts**. Turning the switch off deletes the current phone token; registration errors leave the switch off with a retry, while an unregister error leaves it on so the screen does not claim a state the backend could not save. A blocked Android permission opens the app's system notification settings instead of showing a prompt that cannot appear.

The registered token is remembered on the phone. Sign out deletes this phone's token before the Supabase session is closed, so alerts for that account are not sent after sign-out. If token cleanup cannot reach the backend, sign-out is not completed and the owner sees a retry message.

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

### Bill reminders and tenant delivery

`send-bill-reminders-daily` runs `send-bill-reminders` at 8:00 AM Asia/Manila (`0 0 * * *` in pg_cron UTC). It sends only owner in-app/Expo push reminders for bills that are not finalized: one at two days before the due date and one per day on or after the due date. Owner reminders do not include amounts.

Saving an electricity reading recalculates a bill but does not finalize it or email the tenant. The authenticated `finalize-tenant-bill` function performs explicit finalization and sends the itemized final bill. `resend-tenant-bill` resends an already-finalized bill without changing `billed_at`. Brevo sends can resolve as `sent`, `failed`, or `uncertain`; an uncertain timeout/5xx/network outcome is never automatically resent.

The `split_bill_reminder_delivery` migration adds the owner/tenant reminder types, per-day owner uniqueness, one-per-bill tenant uniqueness, delivery status, attempts, retry state, and Brevo message IDs. It also creates a pre-migration copy at `private.bill_reminders_backup_20261121`.

Set the following Edge Function secrets in the target Supabase project. Do not put their values in app code or commit them:

```sh
npx supabase db push --project-ref <project-ref>
npx supabase secrets set BREVO_API_KEY=<brevo-api-key> BREVO_SENDER_EMAIL=<verified-sender-email> --project-ref <project-ref>
npx supabase functions deploy send-bill-reminders finalize-tenant-bill resend-tenant-bill --project-ref <project-ref>
```

Supabase provides `SUPABASE_URL`; the deployed functions also use the existing server-side `SERVER_API_SECRET`, `BILL_REMINDERS_CRON_TOKEN`, `BREVO_API_KEY`, and `BREVO_SENDER_EMAIL` secrets. Finalize and resend require a signed-in owner JWT. Run the pure checks with `deno test supabase/functions/send-bill-reminders/reminder-logic_test.ts supabase/functions/_shared/bill-email_test.ts`; use a controlled recipient for end-to-end email tests, never a real tenant.

### Notification checks

After applying the migration and configuring push:

1. Sign in as an owner and open Manage. Confirm the bell opens the list, shows an empty state when appropriate, and asks for push permission only after choosing **Enable push alerts**.
2. Allow permission once and confirm the Settings status is **Push notifications enabled.**. Restart the app and confirm the switch remains on.
3. Turn the switch off and confirm this phone token is removed and future pushes stop. Turn it on again, deny once, then block the permission and confirm the Android settings action appears.
4. Register a tenant, generate a bill, add its electricity reading, and mark the bill paid. Confirm the corresponding tenant, bill, reading-required, electricity-charge, and paid notifications appear without refreshing.
5. Use an unfinalized bill due in two days and another due today to check the 8:00 AM owner reminders. Confirm no amount is present and duplicate runs create no second reminder for the same Manila day. Finalized bills must not receive owner reminders.
6. Mark one notification read and then mark all read. Confirm the unread badge and read styling update immediately and remain correct after reopening Manage.
7. With push enabled, sign out and confirm the database no longer contains this phone token for that owner. In-app notifications remain available after sign-in or while phone alerts are off.
5. Sign in as a second owner and attempt to query/update the first owner's notification ID; RLS must return no row and prevent changes.
6. Save a meter reading and confirm it recalculates without finalizing or emailing. Then use **Finalize & send** with a controlled recipient. Confirm the bill is finalized once, can be resent manually, and a tenant without email returns the no-email result.
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