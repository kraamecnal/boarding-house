import { DarkTheme, DefaultTheme, Redirect, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { BillsProvider } from '@/contexts/BillsContext';
import { BoardingHousesProvider } from '@/contexts/BoardingHousesContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { OwnerChargesProvider, useOwnerCharges } from '@/contexts/OwnerChargesContext';
import { RoomsProvider } from '@/contexts/RoomsContext';

SplashScreen.preventAutoHideAsync();

function AppNavigator() {
  const { isLoading, session, hasPaymentPassword, signOut } = useAuth();
  const {
    isLoading: isLoadingCharges,
    loadError: chargesError,
    hasAllCharges,
    reload: reloadCharges,
  } = useOwnerCharges();
  const pathname = usePathname();

  if (isLoading || (session && isLoadingCharges)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#208AEF" />
      </View>
    );
  }

  if (!session && pathname !== '/sign-in' && pathname !== '/auth/callback') {
    return <Redirect href="/sign-in" />;
  }

  // If the setup status can't be checked, don't let anyone through.
  if (session && chargesError) {
    return (
      <View style={styles.loading}>
        <Text style={styles.errorTitle}>We couldn’t check your account setup</Text>
        <Text style={styles.errorMessage}>{chargesError}</Text>
        <Pressable accessibilityRole="button" onPress={reloadCharges} style={styles.retryButton}>
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void signOut().catch(() => undefined)}
          style={styles.signOutButton}>
          <Text style={styles.signOutLabel}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  // Mandatory setup: billing charges + payment password must exist before the app opens.
  const isSetupComplete = hasAllCharges && hasPaymentPassword;
  if (
    session &&
    !isSetupComplete &&
    pathname !== '/billing-charges' &&
    !pathname.startsWith('/auth/')
  ) {
    return <Redirect href="/billing-charges" />;
  }

  if (session && pathname === '/sign-in') {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <>
      <AnimatedSplashOverlay />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: '#FFFFFF' },
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTintColor: '#1E3A8A',
          headerTitleStyle: { color: '#1E3A8A' },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="auth/recover-payment-password" options={{ title: 'Forgot password?' }} />
        <Stack.Screen name="billing-charges" options={{ title: 'Billing charges' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="about" options={{ title: 'About' }} />
        <Stack.Screen name="tenants" options={{ title: 'Tenants' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen
          name="register-house"
          options={{ title: 'Register Boarding House', presentation: 'modal' }}
        />
        <Stack.Screen name="bh/[id]/index" options={{ title: 'InKeeper' }} />
        <Stack.Screen
          name="bh/[id]/room/new"
          options={{ title: 'Create Room', presentation: 'modal' }}
        />
        <Stack.Screen name="bh/[id]/room/[roomId]/index" options={{ title: 'Room' }} />
        <Stack.Screen
          name="bh/[id]/room/[roomId]/meter-reading"
          options={{ title: 'Add Meter Reading' }}
        />
        <Stack.Screen
          name="bh/[id]/room/[roomId]/meter-history"
          options={{ title: 'Meter Reading History' }}
        />
        <Stack.Screen
          name="bh/[id]/room/[roomId]/tenant"
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
        <OwnerChargesProvider>
          <NotificationsProvider>
            <BoardingHousesProvider>
              <RoomsProvider>
                <BillsProvider>
                  <AppNavigator />
                </BillsProvider>
              </RoomsProvider>
            </BoardingHousesProvider>
          </NotificationsProvider>
        </OwnerChargesProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: '#F4F7FB',
  },
  errorTitle: {
    color: '#14243A',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorMessage: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: '#208AEF',
  },
  retryLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  signOutButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  signOutLabel: { color: '#667085', fontSize: 14, fontWeight: '600' },
});