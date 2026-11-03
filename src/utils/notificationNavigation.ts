import type { Href } from 'expo-router';

import type { NotificationType } from '@/utils/notifications';

type NotificationRoute =
  | { pathname: '/bill/[roomId]'; params: { roomId: string; period: string } }
  | { pathname: '/bh/[id]/room/[roomId]'; params: { id: string; roomId: string } }
  | '/tenants';

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function getNotificationRoute(
  type: NotificationType,
  data: Record<string, unknown>,
): Href | null {
  const roomId = stringValue(data.room_id);

  if (type === 'tenancy_ended') {
    return '/tenants';
  }

  if (
    type === 'bill_generated' ||
    type === 'bill_due_soon' ||
    type === 'bill_due_today' ||
    type === 'bill_paid' ||
    type === 'meter_reading_required' ||
    type === 'electricity_charge_added'
  ) {
    const period = stringValue(data.period);
    if (!roomId || !period) return null;
    const route: NotificationRoute = {
      pathname: '/bill/[roomId]',
      params: { roomId, period },
    };
    return route;
  }

  const boardingHouseId = stringValue(data.boarding_house_id);
  if (!roomId || !boardingHouseId) return null;

  const route: NotificationRoute = {
    pathname: '/bh/[id]/room/[roomId]',
    params: { id: boardingHouseId, roomId },
  };
  return route;
}
