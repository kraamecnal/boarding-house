import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { BillsProvider } from '@/contexts/BillsContext'; // NEW
import { RoomsProvider } from '@/contexts/RoomsContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <RoomsProvider>
        <BillsProvider>{/* NEW: wraps the Stack so every screen can call useBills() */}
          <AnimatedSplashOverlay />
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="explore" options={{ title: 'Explore' }} />
            <Stack.Screen name="bh/[id]/index" options={{ title: 'Tenant Keeper' }} />
            <Stack.Screen
              name="bh/[id]/room/new"
              options={{ title: 'Register Tenant', presentation: 'modal' }}
            />
            {/* NEW */}
            <Stack.Screen name="bill/[roomId]" options={{ title: 'Monthly Bill' }} />
          </Stack>
        </BillsProvider>
      </RoomsProvider>
    </ThemeProvider>
  );
}