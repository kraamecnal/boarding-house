import { DarkTheme, DefaultTheme, Redirect, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, StyleSheet, View, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { BillsProvider } from '@/contexts/BillsContext'; 
import { RoomsProvider } from '@/contexts/RoomsContext';

SplashScreen.preventAutoHideAsync();

function AppNavigator() {
  const { isLoading, session } = useAuth();
  const pathname = usePathname();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#208AEF" />
      </View>
    );
  }

  if (!session && pathname !== '/sign-in' && pathname !== '/auth/callback') {
    return <Redirect href="/sign-in" />;
  }

  if (session && pathname === '/sign-in') {
    return <Redirect href="/" />;
  }

  return (
    <>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="explore" options={{ title: 'Explore' }} />
        <Stack.Screen name="bh/[id]/index" options={{ title: 'Tenant Keeper' }} />
        <Stack.Screen
          name="bh/[id]/room/new"
          options={{ title: 'Register Tenant', presentation: 'modal' }}
        />
        <Stack.Screen name="bill/[roomId]" options={{ title: 'Monthly Bill' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RoomsProvider>
          <BillsProvider>
            <AppNavigator />
          </BillsProvider>
        </RoomsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F7FB',
  },
});