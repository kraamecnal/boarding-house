import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { Platform } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeExpoPushToken,
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

type PushPermissionStatus = 'unknown' | 'granted' | 'denied' | 'unsupported';

const PUSH_PERMISSION_PROMPTED_KEY = '@inkeeper/push-permission-prompted';

const ANDROID_EXPO_GO_PUSH_MESSAGE =
  'Android push notifications are unavailable in Expo Go. Use a development or production build; in-app notifications remain available.';

type NotificationsContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  loadError: string | null;
  realtimeError: string | null;
  pushError: string | null;
  pushPermissionStatus: PushPermissionStatus;
  reload: () => void;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  enablePushNotifications: () => Promise<void>;
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
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestId = useRef(0);
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

  const registerPushToken = useCallback(
    async (requestPermission: boolean) => {
      if (Platform.OS === 'web') {
        setPushPermissionStatus('unsupported');
        return;
      }

      if (Platform.OS === 'android' && isRunningInExpoGo()) {
        setPushPermissionStatus('unsupported');
        setPushError(ANDROID_EXPO_GO_PUSH_MESSAGE);
        return;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'InKeeper notifications',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      let permissions = await Notifications.getPermissionsAsync();
      if (!permissions.granted && requestPermission) {
        permissions = await Notifications.requestPermissionsAsync();
      }
      if (!permissions.granted) {
        setPushPermissionStatus('denied');
        if (requestPermission) {
          setPushError('Push notification permission was not granted. In-app notifications remain available.');
        }
        return;
      }

      setPushPermissionStatus('granted');
      setPushError(null);
      if (!ownerId) return;

      const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        throw new Error('Expo push notifications need an EAS project ID in the app configuration.');
      }

      const { data: tokenData } = await Notifications.getExpoPushTokenAsync({ projectId });
      if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
      await saveExpoPushToken(
        ownerId,
        tokenData,
        Platform.OS === 'ios' ? 'ios' : 'android',
      );
    },
    [ownerId],
  );

  useEffect(() => {
    let active = true;
    if (Platform.OS === 'web') {
      setPushPermissionStatus('unsupported');
      return () => {
        active = false;
      };
    }

    if (Platform.OS === 'android' && isRunningInExpoGo()) {
      setPushPermissionStatus('unsupported');
      setPushError(ANDROID_EXPO_GO_PUSH_MESSAGE);
      return () => {
        active = false;
      };
    }

    const initializePushNotifications = async () => {
      try {
        const alreadyPrompted = await AsyncStorage.getItem(PUSH_PERMISSION_PROMPTED_KEY);
        if (!active) return;

        if (alreadyPrompted) {
          const permissions = await Notifications.getPermissionsAsync();
          if (!active) return;
          setPushPermissionStatus(permissions.granted ? 'granted' : 'denied');
          if (permissions.granted && ownerId) await registerPushToken(false);
          return;
        }

        await AsyncStorage.setItem(PUSH_PERMISSION_PROMPTED_KEY, 'true');
        if (active) await registerPushToken(true);
      } catch (error: unknown) {
        if (!active) return;
        setPushError(
          error instanceof Error ? error.message : 'Could not register this device for push notifications.',
        );
      }
    };

    void initializePushNotifications();

    return () => {
      active = false;
    };
  }, [ownerId, registerPushToken]);

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
    try {
      await registerPushToken(true);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not enable push notifications on this device.';
      setPushError(message);
      throw error;
    }
  }, [registerPushToken]);

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
      reload,
      markRead,
      markAllRead,
      enablePushNotifications,
    }),
    [
      enablePushNotifications,
      isLoading,
      loadError,
      markAllRead,
      markRead,
      notifications,
      pushError,
      pushPermissionStatus,
      realtimeError,
      reload,
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
