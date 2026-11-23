import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import {
  AndroidImportance,
  type NotificationPermissionsStatus,
} from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  isExpoPushTokenRegistered,
  removeExpoPushToken,
  rememberExpoPushToken,
  saveExpoPushToken,
  type AppNotification,
  isNotificationType,
} from '@/utils/notifications';
import { getNotificationRoute } from '@/utils/notificationNavigation';
import { getSupabaseClient } from '@/utils/supabase';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export type PushPermissionStatus = 'unknown' | 'granted' | 'denied' | 'blocked' | 'unsupported';
type PushErrorAction = 'check' | 'enable' | 'disable' | null;

const ANDROID_EXPO_GO_PUSH_MESSAGE =
  'Phone alerts are not available in this test version of InKeeper. In-app alerts still work.';

type NotificationsContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  loadError: string | null;
  realtimeError: string | null;
  pushError: string | null;
  pushPermissionStatus: PushPermissionStatus;
  pushEnabled: boolean;
  isPushStateLoading: boolean;
  reload: () => void;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  enablePushNotifications: () => Promise<void>;
  disablePushNotifications: () => Promise<void>;
  refreshPushNotifications: () => Promise<void>;
  retryPushNotifications: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

function notificationIdFromResponse(response: Notifications.NotificationResponse): string | null {
  const value = response.notification.request.content.data?.notification_id;
  return typeof value === 'string' ? value : null;
}

function routeFromResponse(response: Notifications.NotificationResponse): Href | null {
  const data = response.notification.request.content.data;
  if (
    !data ||
    !isNotificationType(data.type) ||
    typeof data.data !== 'object' ||
    data.data === null ||
    Array.isArray(data.data)
  ) {
    return null;
  }
  return getNotificationRoute(data.type, data.data as Record<string, unknown>);
}

export function NotificationsProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const router = useRouter();
  const ownerId = session?.user.id ?? null;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushPermissionStatus, setPushPermissionStatus] =
    useState<PushPermissionStatus>('unknown');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isPushStateLoading, setIsPushStateLoading] = useState(true);
  const [pushErrorAction, setPushErrorAction] = useState<PushErrorAction>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestId = useRef(0);
  const pushRequestId = useRef(0);
  const pendingNotificationRoute = useRef<Href | null>(null);
  const pendingNotificationId = useRef<string | null>(null);

  const reload = useCallback(() => {
    setRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const currentRequestId = ++requestId.current;

    if (!ownerId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoadError(null);
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    setLoadError(null);
    void loadNotifications(ownerId)
      .then((snapshot) => {
        if (!active || currentRequestId !== requestId.current) return;
        setNotifications(snapshot.notifications);
        setUnreadCount(snapshot.unreadCount);
      })
      .catch((error: unknown) => {
        if (!active || currentRequestId !== requestId.current) return;
        setLoadError(
          error instanceof Error ? error.message : 'Could not load notifications.',
        );
      })
      .finally(() => {
        if (active && currentRequestId === requestId.current) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [ownerId, refreshVersion]);

  useEffect(() => {
    if (!ownerId) {
      setRealtimeError(null);
      return;
    }

    const channel = getSupabaseClient()
      .channel(`notifications:${ownerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `owner_id=eq.${ownerId}`,
        },
        () => reload(),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeError(null);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeError('Live updates are temporarily unavailable. Retry to refresh.');
        }
      });

    return () => {
      void getSupabaseClient().removeChannel(channel);
    };
  }, [ownerId, reload]);

  const getExpoPushToken = useCallback(async () => {
    const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      throw new Error('Phone alerts are not set up for this app build.');
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  }, []);

  const prepareAndroidPush = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setPushPermissionStatus('unsupported');
      throw new Error('Phone alerts are available on Android only.');
    }
    if (isRunningInExpoGo()) {
      setPushPermissionStatus('unsupported');
      throw new Error(ANDROID_EXPO_GO_PUSH_MESSAGE);
    }
    await Notifications.setNotificationChannelAsync('default', {
      name: 'InKeeper notifications',
      importance: AndroidImportance.DEFAULT,
    });
  }, []);

  const permissionStatus = useCallback(
    (permissions: NotificationPermissionsStatus): PushPermissionStatus =>
      permissions.granted ? 'granted' : permissions.canAskAgain ? 'denied' : 'blocked',
    [],
  );

  const refreshPushNotifications = useCallback(async () => {
    const operationId = ++pushRequestId.current;
    setIsPushStateLoading(true);
    setPushError(null);
    setPushErrorAction(null);

    try {
      if (!ownerId) {
        setPushPermissionStatus('unknown');
        setPushEnabled(false);
        return;
      }

      await prepareAndroidPush();
      const permissions = await Notifications.getPermissionsAsync();
      if (operationId !== pushRequestId.current) return;

      setPushPermissionStatus(permissionStatus(permissions));
      if (!permissions.granted) {
        setPushEnabled(false);
        return;
      }

      const expoPushToken = await getExpoPushToken();
      const isRegistered = await isExpoPushTokenRegistered(ownerId, expoPushToken);
      if (operationId !== pushRequestId.current) return;

      if (isRegistered) {
        await rememberExpoPushToken(ownerId, expoPushToken);
      }
      setPushEnabled(isRegistered);
    } catch (error: unknown) {
      if (operationId !== pushRequestId.current) return;
      if (Platform.OS !== 'android') {
        setPushPermissionStatus('unsupported');
      }
      setPushEnabled(false);
      setPushError(
        error instanceof Error && error.message === ANDROID_EXPO_GO_PUSH_MESSAGE
          ? error.message
          : 'Could not check phone alerts. Check your internet connection and try again.',
      );
      setPushErrorAction('check');
    } finally {
      if (operationId === pushRequestId.current) setIsPushStateLoading(false);
    }
  }, [getExpoPushToken, ownerId, permissionStatus, prepareAndroidPush]);

  useEffect(() => {
    const timeout = setTimeout(() => void refreshPushNotifications(), 0);
    return () => clearTimeout(timeout);
  }, [refreshPushNotifications]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && ownerId) {
        void refreshPushNotifications();
      }
    });
    return () => subscription.remove();
  }, [ownerId, refreshPushNotifications]);

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!ownerId) throw new Error('Sign in to update notifications.');
      const existing = notifications.find((item) => item.notificationId === notificationId);
      if (existing?.isRead) return;

      const wasUnread = await markNotificationRead(ownerId, notificationId);
      setNotifications((current) =>
        current.map((item) =>
          item.notificationId === notificationId
            ? { ...item, isRead: true, readAt: new Date().toISOString() }
            : item,
        ),
      );
      if (wasUnread) {
        setUnreadCount((count) => Math.max(0, count - 1));
      } else {
        reload();
      }
    },
    [notifications, ownerId, reload],
  );

  const markAllRead = useCallback(async () => {
    if (!ownerId) throw new Error('Sign in to update notifications.');
    await markAllNotificationsRead(ownerId);
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) => ({ ...item, isRead: true, readAt })),
    );
    setUnreadCount(0);
  }, [ownerId]);

  const enablePushNotifications = useCallback(async () => {
    const operationId = ++pushRequestId.current;
    setIsPushStateLoading(true);
    setPushError(null);
    setPushErrorAction(null);

    try {
      if (!ownerId) throw new Error('Sign in to turn on phone alerts.');
      await prepareAndroidPush();

      let permissions = await Notifications.getPermissionsAsync();
      if (!permissions.granted && permissions.canAskAgain) {
        permissions = await Notifications.requestPermissionsAsync();
      }
      if (operationId !== pushRequestId.current) return;

      setPushPermissionStatus(permissionStatus(permissions));
      if (!permissions.granted) {
        setPushEnabled(false);
        return;
      }

      const expoPushToken = await getExpoPushToken();
      await saveExpoPushToken(ownerId, expoPushToken, 'android');
      if (operationId !== pushRequestId.current) return;

      setPushEnabled(true);
    } catch (error: unknown) {
      if (operationId !== pushRequestId.current) return;
      const message =
        error instanceof Error &&
        (error.message === ANDROID_EXPO_GO_PUSH_MESSAGE ||
          error.message === 'Phone alerts are not set up for this app build.')
          ? error.message
          : 'Could not turn on phone alerts. Check your internet connection and try again.';
      setPushEnabled(false);
      setPushError(message);
      setPushErrorAction('enable');
      throw new Error(message);
    } finally {
      if (operationId === pushRequestId.current) setIsPushStateLoading(false);
    }
  }, [getExpoPushToken, ownerId, permissionStatus, prepareAndroidPush]);

  const disablePushNotifications = useCallback(async () => {
    if (!ownerId) throw new Error('Sign in to change phone alerts.');
    const operationId = ++pushRequestId.current;
    setIsPushStateLoading(true);
    setPushError(null);
    setPushErrorAction(null);

    try {
      await removeExpoPushToken(ownerId);
      if (operationId !== pushRequestId.current) return;
      setPushEnabled(false);
    } catch {
      if (operationId !== pushRequestId.current) return;
      const message = 'Could not turn off phone alerts. Check your internet connection and try again.';
      setPushError(message);
      setPushErrorAction('disable');
      throw new Error(message);
    } finally {
      if (operationId === pushRequestId.current) setIsPushStateLoading(false);
    }
  }, [ownerId]);

  const retryPushNotifications = useCallback(async () => {
    if (pushErrorAction === 'enable') {
      await enablePushNotifications();
    } else if (pushErrorAction === 'disable') {
      await disablePushNotifications();
    } else {
      await refreshPushNotifications();
    }
  }, [
    disablePushNotifications,
    enablePushNotifications,
    pushErrorAction,
    refreshPushNotifications,
  ]);

  const responseHandler = useRef<(response: Notifications.NotificationResponse) => void>(() => {});

  useEffect(() => {
    responseHandler.current = (response) => {
      const href = routeFromResponse(response);
      const notificationId = notificationIdFromResponse(response);
      if (notificationId) {
        if (ownerId) {
          void markRead(notificationId).catch((error: unknown) => {
            console.error('Could not mark the opened notification as read.', error);
          });
        } else {
          pendingNotificationId.current = notificationId;
        }
      }
      if (ownerId) {
        if (href) router.push(href);
      } else if (href) {
        pendingNotificationRoute.current = href;
      }
      Notifications.clearLastNotificationResponse();
    };
  }, [markRead, ownerId, router]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const listener = Notifications.addNotificationResponseReceivedListener((response) =>
      responseHandler.current(response),
    );
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) responseHandler.current(lastResponse);

    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!ownerId) return;
    if (pendingNotificationId.current) {
      const notificationId = pendingNotificationId.current;
      pendingNotificationId.current = null;
      void markRead(notificationId).catch((error: unknown) => {
        console.error('Could not mark the opened notification as read.', error);
      });
    }
    if (pendingNotificationRoute.current) {
      router.push(pendingNotificationRoute.current);
      pendingNotificationRoute.current = null;
    }
  }, [markRead, ownerId, router]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      notifications,
      unreadCount,
      isLoading,
      loadError,
      realtimeError,
      pushError,
      pushPermissionStatus,
      pushEnabled,
      isPushStateLoading,
      reload,
      markRead,
      markAllRead,
      enablePushNotifications,
      disablePushNotifications,
      refreshPushNotifications,
      retryPushNotifications,
    }),
    [
      enablePushNotifications,
      disablePushNotifications,
      isLoading,
      isPushStateLoading,
      loadError,
      markAllRead,
      markRead,
      notifications,
      pushError,
      pushEnabled,
      pushPermissionStatus,
      realtimeError,
      reload,
      refreshPushNotifications,
      retryPushNotifications,
      unreadCount,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationsProvider.');
  }
  return context;
}
