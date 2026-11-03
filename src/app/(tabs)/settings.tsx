import Constants from 'expo-constants';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';

type SettingsSection = 'about' | 'version';

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const {
    enablePushNotifications,
    pushError,
    pushPermissionStatus,
  } = useNotifications();
  const [section, setSection] = useState<SettingsSection>('about');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [pushActionError, setPushActionError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const version = Constants.expoConfig?.version ?? 'Unavailable';

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

  const handleEnablePush = async () => {
    setPushActionError(null);
    setIsEnablingPush(true);
    try {
      await enablePushNotifications();
    } catch (error: unknown) {
      setPushActionError(
        error instanceof Error ? error.message : 'Could not enable push notifications.',
      );
    } finally {
      setIsEnablingPush(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        <SectionTab
          label="About"
          selected={section === 'about'}
          onPress={() => setSection('about')}
        />
        <SectionTab
          label="Version"
          selected={section === 'version'}
          onPress={() => setSection('version')}
        />
      </View>

      {section === 'about' ? (
        <View style={styles.card}>
          <Text style={styles.heading}>About InKeeper</Text>
          <Text style={styles.body}>
            InKeeper helps boarding-house owners organize their properties, keep tenant and room
            details together, and track upcoming and unpaid bills.
          </Text>
          <Text style={styles.subheading}>Made for everyday management</Text>
          <Text style={styles.body}>
            Use Boarding Houses to register properties and tenants, and Manage to review billing
            due dates and outstanding balances.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.heading}>App version</Text>
          <Text style={styles.version}>{version}</Text>
          <Text style={styles.body}>
            This is the InKeeper application version installed on your device. Update the app when
            a newer release is available to receive improvements and fixes.
          </Text>
        </View>
      )}
      <View style={styles.card}>
        <Text style={styles.heading}>Push notifications</Text>
        <Text style={styles.body}>
          {Platform.OS === 'web'
            ? 'Push notifications are unavailable on web. In-app notifications remain available.'
            : pushActionError ?? pushError ??
              (pushPermissionStatus === 'granted'
                ? 'Push alerts are enabled for this device.'
                : 'Enable push alerts for this device. In-app notifications remain available.')}
        </Text>
        {Platform.OS !== 'web' &&
          pushPermissionStatus !== 'unsupported' &&
          (pushPermissionStatus !== 'granted' || pushError !== null) && (
            <Pressable
              accessibilityRole="button"
              disabled={isEnablingPush}
              onPress={() => void handleEnablePush()}
              style={styles.pushButton}>
              {isEnablingPush ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.pushButtonLabel}>
                  {pushPermissionStatus === 'granted' ? 'Retry push setup' : 'Enable push alerts'}
                </Text>
              )}
            </Pressable>
          )}
      </View>
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

function SectionTab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.selectedTab]}>
      <Text style={[styles.tabLabel, selected && styles.selectedTabLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 20,
    backgroundColor: '#F8F9FA',
  },
  title: {
    color: '#1A2B3C',
    fontSize: 28,
    fontWeight: '700',
  },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: 10,
    backgroundColor: '#E4E7EC',
  },
  tab: {
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  selectedTab: {
    backgroundColor: '#FFFFFF',
  },
  tabLabel: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
  },
  selectedTabLabel: {
    color: '#1A2B3C',
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
  subheading: {
    marginTop: 8,
    color: '#1A2B3C',
    fontSize: 16,
    fontWeight: '600',
  },
  body: {
    color: '#667085',
    fontSize: 15,
    lineHeight: 23,
  },
  version: {
    color: '#208AEF',
    fontSize: 24,
    fontWeight: '700',
  },
  error: {
    color: '#B42318',
    fontSize: 14,
  },
  signOutButton: {
    minHeight: 48,
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
  pushButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#2563EB',
  },
  pushButtonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
