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

## Supabase passwordless authentication

1. Create a Supabase project and copy its Project URL and publishable key from the project API settings.
2. Copy `.env.example` to `.env` and replace the example values:

   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
   EXPO_PUBLIC_AUTH_REDIRECT_URL=
   ```

   Keep `EXPO_PUBLIC_AUTH_REDIRECT_URL` blank for development. The app creates the callback URI
   for the current Expo environment and logs the exact URI to Metro. For a production web build,
   set it to `https://<your-real-domain>/auth/callback` after the domain is finalized. Do not
   copy the angle-bracket placeholder as a real value. The local `.env` file is ignored by Git.
   Restart Expo after changing environment variables:

   ```bash
   npx expo start --clear
   ```

3. In Supabase **Authentication → URL Configuration**, inspect the existing **Site URL** and do not replace it with an invented domain. When the production web domain is finalized, set Site URL to that real site origin and add its `/auth/callback` URL to **Redirect URLs**. Also add the exact callback URI printed by Metro to Redirect URLs. Expo Go's URI can change with the development session, so update it and request a fresh link when it changes. Native development and production builds use the app scheme `boardinghouse`, with callback `boardinghouse://auth/callback`. For production web, add the real deployed callback URL set in `EXPO_PUBLIC_AUTH_REDIRECT_URL`. The web URL remains a deployment TODO.
4. In Supabase **Authentication → Email Templates → Magic Link**, configure a clickable link compatible with the app's PKCE client. Use the redirect passed by the app and the token hash:

   ```html
   <p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email">Sign in to InKeeper</a></p>
   ```

   Keep the template's `{{ .TokenHash }}` and `{{ .RedirectTo }}` variables intact. Do not use `{{ .Token }}` as the link destination; that is the manually entered OTP. The app callback verifies the token hash and establishes the session. Review the current template in the dashboard before replacing it, since this repository cannot inspect or change hosted Supabase settings.
5. In **Authentication → Providers → Email**, confirm email sign-in is enabled. Review the project's email confirmation setting for new users and confirm it matches the intended registration policy. The app calls `signInWithOtp` with account creation disabled for Sign in and enabled for Sign up. Supabase may avoid revealing whether an email already has an account; users can switch modes if the link behavior does not match their intent.
6. To test, use Sign up with an unused email, open the clickable email link on the same device, and confirm the callback reaches the dashboard only after a session is established. Then sign out and repeat with Sign in. Invalid or expired links show a recovery message rather than a blank page.

Only use the Supabase publishable key in the app. Never put a secret or service-role key in an `EXPO_PUBLIC_` variable or in client code.

Passwordless email authentication is implemented in the app, but it is not confirmed operational until the Supabase dashboard template and redirect allow-list are configured and the complete flow is tested. Boarding houses, rooms, and bills are currently kept in app memory and are not saved to Supabase yet.

The Manage tab shows the dashboard summary. Open the gear menu to visit Billing charges or Profile; the Profile page links to the About and Version information.

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