import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="explore" options={{ title: 'Explore' }} />
          <Stack.Screen name="bh1" options={{ title: 'BH1 Screen' }} />
          <Stack.Screen name="bh2" options={{ title: 'BH2 Screen' }} />
          <Stack.Screen name="bh3" options={{ title: 'BH3 Screen' }} />
          <Stack.Screen name="bh4" options={{ title: 'BH4 Screen' }} />
        </Stack>
    </ThemeProvider>
  );
}