import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  GestureResponderEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ProfileEditModal from '@/components/ProfileEditModal';
import SetPasswordModal from '@/components/SetPasswordModal';
import { DashboardColors } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const {
    session,
    hasPaymentPassword,
    ownerProfile,
    ownerDisplayName,
    ownerProfileError,
    applyOwnerProfileUpdate,
  } = useAuth();
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number } | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const email = ownerProfile?.email ?? session?.user.email ?? 'No email available';
  const displayName = ownerDisplayName;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const showContextMenu = (event: GestureResponderEvent) => {
    const menuWidth = 112;
    const menuHeight = 46;
    const edge = 12;
    const minimumTop = insets.top + 64;
    const maximumTop = Math.max(
      minimumTop,
      windowHeight - Math.max(insets.bottom, edge) - menuHeight - edge,
    );
    const minimumLeft = edge;
    const maximumLeft = Math.max(minimumLeft, windowWidth - menuWidth - edge);
    const proposedLeft = event.nativeEvent.pageX - menuWidth / 2;
    const proposedTop = event.nativeEvent.pageY + 10;

    setContextMenu({
      left: Math.min(Math.max(proposedLeft, minimumLeft), maximumLeft),
      top:
        proposedTop <= maximumTop
          ? Math.max(proposedTop, minimumTop)
          : Math.max(event.nativeEvent.pageY - menuHeight - 10, minimumTop),
    });
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable
          accessibilityLabel={`Edit profile for ${displayName}`}
          accessibilityRole="button"
          delayLongPress={650}
          onLongPress={showContextMenu}
          style={styles.card}>
          <View style={styles.avatar}>
            <Ionicons color={DashboardColors.primary} name="person" size={30} />
          </View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.email}>{email}</Text>
        </Pressable>

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
        {hasPaymentPassword && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/auth/recover-payment-password')}
            style={styles.forgotPassword}>
            <Text style={styles.forgotPasswordLabel}>Forgot password?</Text>
          </Pressable>
        )}
        {passwordSaved && (
          <Text accessibilityLiveRegion="polite" style={styles.success}>
            Payment password saved.
          </Text>
        )}
        {ownerProfileError && (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {ownerProfileError}
          </Text>
        )}
        {notice && (
          <View accessibilityLiveRegion="polite" style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        <SetPasswordModal
          visible={passwordModalVisible}
          onClose={() => setPasswordModalVisible(false)}
          onSaved={() => {
            setPasswordModalVisible(false);
            setPasswordSaved(true);
          }}
        />
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setContextMenu(null)}
        statusBarTranslucent
        transparent
        visible={contextMenu !== null}>
        <View style={styles.contextMenuOverlay}>
          <Pressable
            accessibilityLabel="Dismiss edit menu"
            accessibilityRole="button"
            onPress={() => setContextMenu(null)}
            style={StyleSheet.absoluteFill}
          />
          {contextMenu && (
            <Pressable
              accessibilityLabel="Edit profile"
              accessibilityRole="menuitem"
              onPress={() => {
                setContextMenu(null);
                setEditingProfile(true);
              }}
              style={({ pressed }) => [
                styles.contextMenu,
                { left: contextMenu.left, top: contextMenu.top },
                pressed && styles.contextMenuPressed,
              ]}>
              <Ionicons color="#2563EB" name="create-outline" size={19} />
              <Text style={styles.contextMenuLabel}>Edit</Text>
            </Pressable>
          )}
        </View>
      </Modal>

      {editingProfile && session?.user.id && (
        <ProfileEditModal
          ownerId={session.user.id}
          currentName={displayName}
          currentEmail={session.user.email ?? ''}
          storedFullName={ownerProfile?.fullName ?? null}
          onCancel={() => setEditingProfile(false)}
          onSaved={(updatedProfile) => {
            applyOwnerProfileUpdate(updatedProfile);
            setEditingProfile(false);
            setNotice('Profile updated');
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: DashboardColors.white,
  },
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 18,
    backgroundColor: DashboardColors.white,
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
  forgotPassword: {
    alignSelf: 'stretch',
    alignItems: 'flex-end',
    marginTop: -12,
  },
  forgotPasswordLabel: {
    color: DashboardColors.primary,
    fontSize: 13,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
  },
  success: {
    color: '#067647',
    fontSize: 14,
  },
  notice: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1F2937',
  },
  noticeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  contextMenuOverlay: {
    flex: 1,
  },
  contextMenu: {
    position: 'absolute',
    width: 112,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 7,
    elevation: 6,
  },
  contextMenuPressed: {
    backgroundColor: '#EFF6FF',
  },
  contextMenuLabel: {
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '700',
  },
});