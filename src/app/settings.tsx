import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const {
    disablePushNotifications,
    enablePushNotifications,
    isPushStateLoading,
    pushEnabled,
    pushError,
    pushPermissionStatus,
    refreshPushNotifications,
    retryPushNotifications,
  } = useNotifications();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [pushActionError, setPushActionError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const pushIsBlocked = pushPermissionStatus === 'blocked';
  const pushIsUnsupported = pushPermissionStatus === 'unsupported';
  const pushStatusText = pushActionError
    ? pushActionError
    : pushError
      ? pushError
      : pushEnabled
        ? 'Push notifications are enabled.'
        : pushIsBlocked
          ? 'Android will not show the permission prompt again. Open notification settings to allow InKeeper alerts.'
          : pushPermissionStatus === 'granted'
            ? 'Push alerts are off for this phone.'
            : 'Push notifications are disabled';

  useFocusEffect(
    useCallback(() => {
      void refreshPushNotifications();
    }, [refreshPushNotifications]),
  );

  const handleSignOut = async () => {
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error: unknown) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out. Try again.');
    } finally {
      setIsSigningOut(false);
    }
  };

  const handlePushChange = async (nextValue: boolean) => {
    setPushActionError(null);
    try {
      if (nextValue) await enablePushNotifications();
      else await disablePushNotifications();
    } catch (error: unknown) {
      setPushActionError(
        error instanceof Error ? error.message : 'Could not change phone alerts. Try again.',
      );
    }
  };

  const handlePushRetry = async () => {
    setPushActionError(null);
    try {
      await retryPushNotifications();
    } catch (error: unknown) {
      setPushActionError(
        error instanceof Error ? error.message : 'Could not change phone alerts. Try again.',
      );
    }
  };

  const handleOpenNotificationSettings = async () => {
    setPushActionError(null);
    try {
      await Linking.openSettings();
    } catch {
      setPushActionError('Could not open phone settings. Open Android settings and find InKeeper.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>Push notifications</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchLabel}>Enable push alerts</Text>
            <Text style={styles.helper}>Show InKeeper reminders on this Android phone.</Text>
          </View>
          <Switch
            accessibilityLabel="Enable push alerts"
            disabled={isPushStateLoading || pushIsUnsupported}
            onValueChange={(nextValue) => void handlePushChange(nextValue)}
            trackColor={{ false: '#D0D5DD', true: '#84ADFF' }}
            thumbColor={pushEnabled ? '#2563EB' : '#F2F4F7'}
            value={pushEnabled}
          />
        </View>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.body,
            (pushError || pushActionError) && styles.error,
            pushEnabled && styles.success,
          ]}>
          {isPushStateLoading
            ? 'Checking push alerts…'
            : pushIsUnsupported
              ? pushError ?? 'Phone alerts are not available in this app build. In-app alerts still work.'
              : pushStatusText}
        </Text>
        {pushIsBlocked && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleOpenNotificationSettings()}
            style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonLabel}>Open notification settings</Text>
          </Pressable>
        )}
        {!pushIsBlocked && (pushError || pushActionError) && (
          <Pressable
            accessibilityRole="button"
            disabled={isPushStateLoading}
            onPress={() => void handlePushRetry()}
            style={styles.retryButton}>
            <Text style={styles.retryButtonLabel}>Try again</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/about')}
        style={({ pressed }) => [styles.aboutCard, pressed && styles.aboutCardPressed]}>
        <View style={styles.aboutIcon}>
          <Ionicons color="#2563EB" name="information-circle-outline" size={23} />
        </View>
        <Text style={styles.aboutLabel}>About InKeeper</Text>
        <Ionicons color="#64748B" name="chevron-forward" size={20} />
      </Pressable>
      {signOutError && <Text accessibilityLiveRegion="polite" style={styles.error}>{signOutError}</Text>}
      <Pressable
        accessibilityRole="button"
        disabled={isSigningOut}
        onPress={handleSignOut}
        style={styles.signOutButton}>
        {isSigningOut ? (
          <ActivityIndicator size="small" color="#B42318" />
        ) : (
          <Text style={styles.signOutLabel}>Sign out</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 20,
    backgroundColor: '#F8F9FA',
  },
  card: {
    padding: 20,
    gap: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  heading: {
    color: '#1A2B3C',
    fontSize: 20,
    fontWeight: '700',
  },
  body: {
    color: '#667085',
    fontSize: 15,
    lineHeight: 23,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
  },
  success: {
    color: '#067647',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  switchCopy: {
    flex: 1,
    gap: 4,
  },
  switchLabel: {
    color: '#1A2B3C',
    fontSize: 15,
    fontWeight: '600',
  },
  helper: {
    color: '#667085',
    fontSize: 13,
    lineHeight: 19,
  },
  aboutCard: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  aboutCardPressed: {
    backgroundColor: '#EFF6FF',
  },
  aboutIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
  },
  aboutLabel: {
    flex: 1,
    color: '#1E293B',
    fontSize: 15,
    fontWeight: '600',
  },
  signOutButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#FEE4E2',
  },
  signOutLabel: {
    color: '#B42318',
    fontSize: 15,
    fontWeight: '700',
  },
  retryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#2563EB',
  },
  retryButtonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 10,
  },
  secondaryButtonLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '700',
  },
});
