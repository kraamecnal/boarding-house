import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSupabaseClient } from '@/utils/supabase';

export type NotificationType =
  | 'bill_generated'
  | 'bill_due_soon'
  | 'bill_due_today'
  | 'bill_paid'
  | 'tenant_registered'
  | 'tenant_moved_in'
  | 'tenancy_ended'
  | 'meter_reading_required'
  | 'electricity_charge_added';

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    value === 'bill_generated' ||
    value === 'bill_due_soon' ||
    value === 'bill_due_today' ||
    value === 'bill_paid' ||
    value === 'tenant_registered' ||
    value === 'tenant_moved_in' ||
    value === 'tenancy_ended' ||
    value === 'meter_reading_required' ||
    value === 'electricity_charge_added'
  );
}

export type AppNotification = {
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedRecordType: string | null;
  relatedRecordId: string | null;
  data: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
};

type NotificationRow = {
  notification_id: string;
  type: NotificationType;
  title: string;
  message: string;
  related_record_type: string | null;
  related_record_id: string | null;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

export type NotificationSnapshot = {
  notifications: AppNotification[];
  unreadCount: number;
};

function mapNotification(row: NotificationRow): AppNotification {
  return {
    notificationId: row.notification_id,
    type: row.type,
    title: row.title,
    message: row.message,
    relatedRecordType: row.related_record_type,
    relatedRecordId: row.related_record_id,
    data: row.data,
    isRead: row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export async function loadNotifications(ownerId: string): Promise<NotificationSnapshot> {
  const client = getSupabaseClient();
  const [listResult, countResult] = await Promise.all([
    client
      .from('notifications')
      .select(
        'notification_id, type, title, message, related_record_type, related_record_id, data, is_read, created_at, read_at',
      )
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(1000),
    client
      .from('notifications')
      .select('notification_id', { count: 'exact', head: true })
      .eq('owner_id', ownerId)
      .eq('is_read', false),
  ]);

  if (listResult.error) throw listResult.error;
  if (countResult.error) throw countResult.error;

  return {
    notifications: ((listResult.data ?? []) as NotificationRow[]).map(mapNotification),
    unreadCount: countResult.count ?? 0,
  };
}

export async function markNotificationRead(
  ownerId: string,
  notificationId: string,
): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('owner_id', ownerId)
    .eq('notification_id', notificationId)
    .eq('is_read', false)
    .select('notification_id')
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export async function markAllNotificationsRead(ownerId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('owner_id', ownerId)
    .eq('is_read', false);

  if (error) throw error;
}

let registeredExpoPushToken: string | null = null;
let registeredOwnerId: string | null = null;
const PUSH_TOKEN_STORAGE_KEY = '@inkeeper/registered-push-token';

type StoredPushToken = {
  ownerId: string;
  expoPushToken: string;
};

export async function rememberExpoPushToken(
  ownerId: string,
  expoPushToken: string,
): Promise<void> {
  registeredExpoPushToken = expoPushToken;
  registeredOwnerId = ownerId;

  try {
    await AsyncStorage.setItem(
      PUSH_TOKEN_STORAGE_KEY,
      JSON.stringify({ ownerId, expoPushToken } satisfies StoredPushToken),
    );
  } catch (error: unknown) {
    console.error('Could not remember the registered push token on this phone.', error);
  }
}

async function loadRememberedExpoPushToken(ownerId: string): Promise<string | null> {
  if (registeredExpoPushToken && registeredOwnerId === ownerId) {
    return registeredExpoPushToken;
  }

  try {
    const stored = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<StoredPushToken>;
    if (
      value.ownerId === ownerId &&
      typeof value.expoPushToken === 'string' &&
      value.expoPushToken.length > 0
    ) {
      registeredExpoPushToken = value.expoPushToken;
      registeredOwnerId = ownerId;
      return value.expoPushToken;
    }
  } catch (error: unknown) {
    console.error('Could not read the registered push token on this phone.', error);
  }

  return null;
}

async function clearRememberedExpoPushToken(ownerId: string, expoPushToken: string): Promise<void> {
  if (registeredExpoPushToken === expoPushToken && registeredOwnerId === ownerId) {
    registeredExpoPushToken = null;
    registeredOwnerId = null;
  }

  try {
    const stored = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    if (!stored) return;
    const value = JSON.parse(stored) as Partial<StoredPushToken>;
    if (value.ownerId === ownerId && value.expoPushToken === expoPushToken) {
      await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
    }
  } catch (error: unknown) {
    console.error('Could not clear the registered push token on this phone.', error);
  }
}

export async function isExpoPushTokenRegistered(
  ownerId: string,
  expoPushToken: string,
): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from('device_push_tokens')
    .select('expo_push_token')
    .eq('owner_id', ownerId)
    .eq('expo_push_token', expoPushToken)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export async function saveExpoPushToken(
  ownerId: string,
  expoPushToken: string,
  platform: 'ios' | 'android',
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('device_push_tokens')
    .upsert(
      {
        expo_push_token: expoPushToken,
        owner_id: ownerId,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' },
    );

  if (error) throw error;
  await rememberExpoPushToken(ownerId, expoPushToken);
}

export async function removeExpoPushToken(
  ownerId: string,
  expoPushToken?: string,
): Promise<void> {
  const token = expoPushToken ?? (await loadRememberedExpoPushToken(ownerId));
  if (!token) return;

  const { error } = await getSupabaseClient()
    .from('device_push_tokens')
    .delete()
    .eq('owner_id', ownerId)
    .eq('expo_push_token', token);

  if (error) throw error;
  await clearRememberedExpoPushToken(ownerId, token);
}
