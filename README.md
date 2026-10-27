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

## Supabase authentication

1. Create a Supabase project and copy its Project URL and publishable key from the project API settings.
2. Copy `.env.example` to `.env` and replace the example values:

   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
   ```

   The local `.env` file is ignored by Git. Restart Expo after changing it:

   ```bash
   npx expo start --clear
   ```

3. Keep the Supabase confirmation email link set to `{{ .ConfirmationURL }}` so Supabase verifies the email before redirecting to the app.
4. For **Expo Go**, sign up once and copy the `Supabase email confirmation redirect` URI from the Metro terminal. Add that exact URI (it will start with `exp://` or `exps://` and contain `/--/auth/callback`) under Supabase **Authentication → URL Configuration → Redirect URLs**. If the Expo Go development URL changes, update the allow-list entry and request a new confirmation email.
5. For an installed Android development or production build, add `boardinghouse://auth/callback` to the same Supabase Redirect URLs list. Rebuild and reinstall after changing the app scheme.
6. Create an account from the sign-up tab and open its confirmation email on the Android device while the Expo Go development server is reachable. The app verifies the callback and returns to sign in.

Only use the Supabase publishable key in the app. Never put a secret or service-role key in an `EXPO_PUBLIC_` variable or in client code.

Authentication is connected to Supabase. Boarding houses, rooms, and bills are currently kept in app memory and are not saved to Supabase yet.

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
