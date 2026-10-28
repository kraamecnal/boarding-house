import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import SetPasswordModal from '@/components/SetPasswordModal';
import { DashboardColors } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';

export default function ProfileScreen() {
  const router = useRouter();
  const { session, signOut, hasPaymentPassword } = useAuth();
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const email = session?.user.email ?? 'No email available';
  const metadata = session?.user.user_metadata ?? {};
  const displayName = [metadata.full_name, metadata.name, metadata.display_name].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Ionicons color={DashboardColors.primary} name="person" size={30} />
        </View>
        <Text style={styles.name}>{displayName?.trim() ?? email.split('@')[0]}</Text>
        <Text style={styles.email}>{email}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setPasswordSaved(false);
          setPasswordModalVisible(true);
        }}
        style={styles.row}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>
            {hasPaymentPassword ? 'Change payment password' : 'Set payment password'}
          </Text>
          <Text style={styles.rowDescription}>
            {hasPaymentPassword
              ? 'Required to mark bills as paid'
              : 'Not set yet. Required to mark bills as paid'}
          </Text>
        </View>
        <Ionicons color={DashboardColors.neutral} name="chevron-forward" size={20} />
      </Pressable>
      {passwordSaved && (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          Payment password saved.
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/settings')}
        style={styles.row}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>About and version</Text>
          <Text style={styles.rowDescription}>App information and release version</Text>
        </View>
        <Ionicons color={DashboardColors.neutral} name="chevron-forward" size={20} />
      </Pressable>

      {signOutError && <Text accessibilityLiveRegion="polite" style={styles.error}>{signOutError}</Text>}
      <Pressable
        accessibilityRole="button"
        disabled={isSigningOut}
        onPress={handleSignOut}
        style={styles.signOut}>
        {isSigningOut ? (
          <ActivityIndicator color={DashboardColors.primary} />
        ) : (
          <Text style={styles.signOutLabel}>Sign out</Text>
        )}
      </Pressable>

      <SetPasswordModal
        visible={passwordModalVisible}
        onClose={() => setPasswordModalVisible(false)}
        onSaved={() => {
          setPasswordModalVisible(false);
          setPasswordSaved(true);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 18,
    backgroundColor: DashboardColors.white,
  },
  title: {
    color: DashboardColors.dark,
    fontSize: 26,
    fontWeight: '700',
  },
  card: {
    alignItems: 'center',
    padding: 24,
    gap: 8,
    borderRadius: 18,
    backgroundColor: DashboardColors.pale,
  },
  avatar: {
    width: 68,
    height: 68,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 34,
    backgroundColor: DashboardColors.light,
  },
  name: {
    marginTop: 4,
    color: DashboardColors.dark,
    fontSize: 19,
    fontWeight: '700',
  },
  email: {
    color: DashboardColors.neutral,
    fontSize: 14,
  },
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: DashboardColors.light,
    borderRadius: 14,
  },
  rowCopy: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    color: DashboardColors.dark,
    fontSize: 15,
    fontWeight: '600',
  },
  rowDescription: {
    color: DashboardColors.neutral,
    fontSize: 12,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
  },
  success: {
    color: '#067647',
    fontSize: 14,
  },
  signOut: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: DashboardColors.border,
    borderRadius: 12,
  },
  signOutLabel: {
    color: DashboardColors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
});