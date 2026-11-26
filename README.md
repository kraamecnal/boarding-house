# InKeeper

InKeeper is an [Expo](https://expo.dev) app for managing boarding houses, rooms, tenants, meter readings, bills, and notifications with Supabase.

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

Screens are in `src/app`, using [file-based routing](https://docs.expo.dev/router/introduction). After signing in for the first time, complete Billing Charges and set a payment password before accessing the main tabs.

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

   If sign-up confirmation is enabled, make the same change to the **Confirm signup** template. Do not include an OTP in a URL or log it. The normal sign-in flow verifies the code directly; the app also has an auth callback screen that can handle supported email links.
4. For payment-password recovery, configure the **Reset Password** authentication email template (called **Change Password** in some dashboard views) to show `{{ .Token }}` as the six-digit code, with copy explaining that it resets the InKeeper payment password. Do not use only `{{ .ConfirmationURL }}` or the separate **Password changed** notification template. An example exists at `supabase/templates/recovery.html`, but it is not configured in `supabase/config.toml`; configure it separately for local and hosted projects.
5. In **Authentication → Sign In / Providers → Email**, confirm email authentication is enabled and set **Email OTP Length** to `6`. This is a hosted-project setting; `supabase/config.toml` also sets `auth.email.otp_length = 6` for local Supabase development, but changing that file does not update the hosted project. Review the **Email OTP expiration** and email rate-limit settings as well. The app applies a 60-second recovery-code resend cooldown. Sign In requests do not create users; Sign Up requests allow Supabase to create an unconfirmed user. Supabase uses the `email` verification type for both flows.
6. Test Sign Up with an unused email, enter the received code in the app, and confirm the app opens its authenticated screen. Sign out and repeat with an existing account in Sign In mode. Incorrect and expired codes should show an error without clearing the entered code.

The existing payment-password flow stores the payment password as the user's Supabase Auth account password. Email OTP is the app's sign-in flow, but resetting the payment password also changes that account password. Recovery verifies a `recovery` OTP in a non-persistent client and updates the password only when the verified user matches the signed-in user.

Only use the Supabase publishable key in the app. Never put a secret or service-role key in an `EXPO_PUBLIC_` variable or in client code.

Email OTP authentication is implemented in the app, but it is not confirmed operational until the Supabase email templates are configured to send numerical codes and both flows are tested. Boarding houses, rooms, tenants, tenancies, and monthly bills are stored in Supabase.

## Database and tenant documents

The active migrations are `supabase/migrations/20261126000000_baseline.sql` and `supabase/migrations/20261126000001_baseline_missing_objects.sql`. They represent a baseline, not the earlier individual feature migrations. Before applying anything, check the target project's migration history and review both files. Do not apply a fresh baseline blindly to an existing database or use migration repair as a substitute for applying schema changes.

The second baseline contains scheduled job URLs pointing to a specific Supabase project, including a `send-tenant-bill-emails` function that is not present in this repository. Review and adapt the scheduled jobs for the intended environment before using the baseline elsewhere. The migrations contain Storage policies, but do not create the `tenant-documents` bucket; configure a private bucket in the target project separately.

The app accepts JPEG, PNG, and WebP tenant documents up to 5 MB. Storage policies validate room ownership through `rooms` and `boarding_house`, and read access requires a matching document path in the owner's tenant, tenancy, or archive record. A non-exposed `private` helper checks references across owners before deletion. The app also recognizes paths in the older `Tenant_documents` bucket, if that bucket and suitable policies exist in the target project.

Tenant document paths are saved in `tenants.id_photo_url` and `tenancy.agreement_photo_url`. The app uses short-lived signed URLs for viewing. Replacing a document uploads a new file, updates the corresponding path, and attempts to remove the old file only when it is unreferenced. Camera access is configured through the Expo Image Picker plugin, so rebuild native development clients after changing permission configuration.

Rooms delete mode archives affected tenancies and document paths before deleting rooms and preserves their bills and meter readings. Regression fixtures are in `supabase/tests/`; run them only against an isolated test database with the appropriate schema. Check the installed Supabase CLI's `db query --help` for the target and file options before running a fixture.

Billing cycles are anchored to the tenancy's move-in date, with dates clamped to the last day of shorter months. Record the move-in reading on the tenant's move-in date. Scheduled present readings are entered from the Monthly Bill; the database saves the reading and electricity bill item together, using the tenancy rate first and the owner default second. A missing move-in reading or rate does not create an estimated electricity charge. At move-out, the user selects either a final reading or no electricity charge.

The Manage tab shows the dashboard summary. Open the gear menu to visit Billing Charges, Profile, Tenants, or Settings. Settings is a normal screen, so Android's back action returns to Manage. The drawer shows the installed app version at its bottom. Open About InKeeper from Settings to read the app's About information.

## Notifications

The Manage tab's bell opens the owner's notification history. In-app entries are created from database events, are scoped to the signed-in owner by RLS, and update through Supabase Realtime. The baseline defines `private.create_bill_due_notifications()` for unpaid bills due today or in two days, but does not schedule that function. Verify the target project's actual scheduled jobs before relying on daily owner due-date notifications.

Push delivery requires a development or production native build, granted notification permission, and valid Expo/EAS push credentials for the project. Android remote push is not supported in Expo Go; use a development build to enable it. Push is optional: the notification list and Realtime updates still work when a device has not granted permission.

The `send-notification-push` Edge Function checks a webhook secret and uses `SERVER_API_SECRET` server-side to retrieve notifications and device tokens. It sends through Expo Push Service. Neither server credentials nor push credentials belong in the app. Configure the function's gateway authentication consistently with its webhook-based invocation before deploying it.

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

The baseline schedules `send-bill-reminders-daily` for 8:00 AM Asia/Manila (`0 0 * * *` UTC). The local `send-bill-reminders` function sends **tenant emails** for unpaid, finalized bills due within three days or overdue, skipping tenants without an email address. It uses Resend and includes the bill amount. It does not record delivery in `bill_reminders` or deduplicate sends, so repeated successful runs can send repeated emails.

The scheduled job supplies a cron-token header, but the local function does not validate it. Do not expose or deploy this function expecting that header alone to protect it; review gateway authentication and implement suitable request authorization before enabling scheduled delivery. The baseline also schedules a separate `daily-tenant-bill-emails` job for a function not included in this repository. Review the target project's jobs and deployed functions to avoid unintended or duplicate emails.

Saving an electricity reading recalculates a bill but does not finalize it or email the tenant. The authenticated `finalize-tenant-bill` function performs explicit finalization and sends the itemized final bill. `resend-tenant-bill` resends an already-finalized bill without changing `billed_at`. Resend sends can resolve as `sent`, `failed`, or `uncertain`; an uncertain timeout/5xx/network outcome is never automatically resent.

The baseline defines reminder types and delivery-tracking fields in `bill_reminders`, as well as a `private.bill_reminders_backup_20261121` table. The finalize and resend functions use the delivery-tracking fields; the current `send-bill-reminders` implementation does not.

Supabase provides `SUPABASE_URL`. Finalize and resend require server-side `SERVER_API_SECRET` and `RESEND_API_KEY`, and default to `InKeeper <billing@innk3eper.xyz>`; set `RESEND_SENDER_EMAIL` to a sender verified for your Resend account if needed. The reminder function uses `SUPABASE_SERVICE_ROLE_KEY` or `SERVER_API_SECRET` and `RESEND_API_KEY`, with a sender hard-coded in its implementation. Keep these secrets out of app code and version control.

Finalize and resend require a signed-in owner JWT. Pure checks can be run with `deno test supabase/functions/send-bill-reminders/reminder-logic_test.ts supabase/functions/_shared/bill-email_test.ts`; the reminder-logic tests do not verify that the current reminder handler uses that module. Use a controlled recipient for end-to-end email tests, never a real tenant.

### Notification checks

After applying the migration and configuring push:

1. Sign in as an owner and open Manage. Confirm the bell opens the list and shows an empty state when appropriate. Confirm push permission is requested only after choosing **Enable push alerts** in Settings.
2. Allow permission once and confirm the Settings status is **Push notifications enabled.**. Restart the app and confirm the switch remains on.
3. Turn the switch off and confirm this phone token is removed and future pushes stop. Turn it on again, deny once, then block the permission and confirm the Android settings action appears.
4. Register a tenant, generate a bill, add its electricity reading, and mark the bill paid. Confirm the corresponding tenant, bill, reading-required, electricity-charge, and paid notifications appear without refreshing.
5. In an isolated test environment, verify any configured owner due-notification job separately from tenant email reminders. Use a controlled email recipient and check the scheduled job's target and authentication before invoking it.
6. Mark one notification read and then mark all read. Confirm the unread badge and read styling update immediately and remain correct after reopening Manage.
7. With push enabled, sign out and confirm the database no longer contains this phone token for that owner. In-app notifications remain available after sign-in or while phone alerts are off.
8. Sign in as a second owner and attempt to query/update the first owner's notification ID; RLS must return no row and prevent changes.
9. Save a meter reading and confirm it recalculates without finalizing or emailing. Then use **Finalize & send** with a controlled recipient. Confirm the bill is finalized once, can be resent manually, and a tenant without email returns the no-email result.
10. Disable or invalidate a device push token and verify in-app notification creation still succeeds. Check Edge Function logs for delivery errors; push failures must not interrupt the primary workflow.

## Reset script

`npm run reset-project` is a starter-template script, not a setup step for InKeeper. It prompts to either move the existing `src` and `scripts` directories into `example` or delete them, then creates a blank `src/app`. Do not run it unless you intentionally want to replace the application.

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