import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DashboardColors } from '@/constants/theme';
import { useNotifications } from '@/contexts/NotificationsContext';
import { getNotificationRoute } from '@/utils/notificationNavigation';
import type { AppNotification } from '@/utils/notifications';

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function NotificationsScreen() {
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    isLoading,
    loadError,
    realtimeError,
    reload,
    markRead,
    markAllRead,
  } = useNotifications();
  const [actionError, setActionError] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [pendingNotificationId, setPendingNotificationId] = useState<string | null>(null);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectNotification = async (notification: AppNotification) => {
    setPendingNotificationId(notification.notificationId);
    setActionError(null);
    try {
      if (!notification.isRead) await markRead(notification.notificationId);
      const route = getNotificationRoute(notification.type, notification.data);
      if (route) router.push(route);
    } catch (error: unknown) {
      setActionError(
        error instanceof Error ? error.message : 'Could not update this notification.',
      );
    } finally {
      setPendingNotificationId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setIsMarkingAll(true);
    setActionError(null);
    try {
      await markAllRead();
    } catch (error: unknown) {
      setActionError(
        error instanceof Error ? error.message : 'Could not mark notifications as read.',
      );
    } finally {
      setIsMarkingAll(false);
    }
  };

  const errorMessage = actionError ?? loadError ?? realtimeError;

  if (isLoading) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator color={DashboardColors.primary} size="large" />
        <Text style={styles.stateText}>Loading notifications…</Text>
      </View>
    );
  }

  if (notifications.length === 0 && !errorMessage) {
    return (
      <View style={styles.emptyState}>
        <Ionicons color="#2563EB" name="notifications" size={32} />
        <Text style={styles.emptyMessage}>No notifications as of now</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {errorMessage && (
        <View style={styles.errorRow}>
          <Text accessibilityLiveRegion="polite" style={styles.errorText}>
            {errorMessage}
          </Text>
          {(loadError || realtimeError) && (
            <Pressable accessibilityRole="button" onPress={reload} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          )}
        </View>
      )}
      {notifications.length > 0 && unreadCount > 0 && (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={isMarkingAll}
            onPress={() => void handleMarkAllRead()}
            style={styles.markAllButton}>
            {isMarkingAll ? (
              <ActivityIndicator color={DashboardColors.primary} size="small" />
            ) : (
              <Text style={styles.markAllLabel}>Mark all read</Text>
            )}
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {notifications.map((notification) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !notification.isRead }}
            disabled={pendingNotificationId === notification.notificationId}
            key={notification.notificationId}
            onPress={() => void selectNotification(notification)}
            style={({ pressed }) => [
              styles.notification,
              !notification.isRead && styles.unreadNotification,
              pressed && styles.notificationPressed,
            ]}>
            <View style={styles.notificationIcon}>
              <Ionicons
                color={notification.isRead ? DashboardColors.neutral : DashboardColors.primary}
                name={notification.type.startsWith('bill_') ? 'receipt-outline' : 'notifications-outline'}
                size={19}
              />
            </View>
            <View style={styles.notificationCopy}>
              <View style={styles.notificationHeading}>
                <Text numberOfLines={1} style={styles.notificationTitle}>
                  {notification.title}
                </Text>
                {!notification.isRead && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.notificationMessage}>{notification.message}</Text>
              <Text style={styles.timestamp}>{formatTimestamp(notification.createdAt)}</Text>
            </View>
            {pendingNotificationId === notification.notificationId && (
              <ActivityIndicator color={DashboardColors.primary} size="small" />
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
  },
  emptyMessage: {
    color: DashboardColors.text,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
  },
  stateText: {
    color: DashboardColors.neutral,
    fontSize: 13,
  },
  actions: {
    minHeight: 48,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  markAllButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  markAllLabel: {
    color: DashboardColors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    margin: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FEF3F2',
  },
  errorText: {
    flex: 1,
    color: '#B42318',
    fontSize: 12,
  },
  retryButton: {
    padding: 4,
  },
  retryLabel: {
    color: DashboardColors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  list: {
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  notification: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 13,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
  },
  unreadNotification: {
    borderWidth: 1,
    borderColor: DashboardColors.border,
    backgroundColor: DashboardColors.pale,
  },
  notificationPressed: {
    opacity: 0.75,
  },
  notificationIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: DashboardColors.white,
  },
  notificationCopy: {
    flex: 1,
    gap: 4,
  },
  notificationHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notificationTitle: {
    flex: 1,
    color: DashboardColors.dark,
    fontSize: 14,
    fontWeight: '700',
  },
  notificationMessage: {
    color: DashboardColors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  timestamp: {
    marginTop: 2,
    color: DashboardColors.neutral,
    fontSize: 11,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: DashboardColors.primary,
  },
});
