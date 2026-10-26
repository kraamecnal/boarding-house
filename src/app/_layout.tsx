import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { BillsProvider } from '@/contexts/BillsContext';
import { BoardingHousesProvider } from '@/contexts/BoardingHousesContext';
import { RoomsProvider } from '@/contexts/RoomsContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <BoardingHousesProvider>
        <RoomsProvider>
          <BillsProvider>
            <AnimatedSplashOverlay />
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="register-house"
                options={{ title: 'Register Boarding House', presentation: 'modal' }}
              />
              <Stack.Screen name="bh/[id]/index" options={{ title: 'Tenant Keeper' }} />
              <Stack.Screen
                name="bh/[id]/room/new"
                options={{ title: 'Register Tenant', presentation: 'modal' }}
              />
              <Stack.Screen name="bill/[roomId]" options={{ title: 'Monthly Bill' }} />
            </Stack>
          </BillsProvider>
        </RoomsProvider>
      </BoardingHousesProvider>
    </ThemeProvider>
  );
}