import type { BillRecord } from '@/contexts/BillsContext';
import type { Room } from '@/contexts/RoomsContext';
import { computeTotals, currentPeriod, daysBetween, listPeriods, todayIso } from '@/utils/billing';

export type DueItem = {
  key: string;
  room: Room;
  period: string; // billing month, 'YYYY-MM'
  dueDate: string; // 'YYYY-MM-DD'
  daysUntilDue: number; // negative = overdue
  total: number;
  electricityEntered: boolean;
};

export type DueSummary = {
  upcoming: DueItem[]; // unpaid, due today or later, soonest first
  overdue: DueItem[]; // unpaid, past due, oldest first
};

type GetBill = (roomId: string, period: string) => BillRecord;

/**
 * Walks every month from each tenant's start month through the current month.
 * Months with no stored record are treated as unpaid (getBill returns defaults).
 */
export function computeDues(rooms: Room[], getBill: GetBill): DueSummary {
  const today = todayIso();
  const thisPeriod = currentPeriod();

  const upcoming: DueItem[] = [];
  const overdue: DueItem[] = [];

  for (const room of rooms) {
    const startPeriod = room.startDate.slice(0, 7);
    if (startPeriod > thisPeriod) continue; // tenant hasn't started yet

    for (const period of listPeriods(startPeriod, thisPeriod)) {
      const record = getBill(room.id, period);
      if (record.status === 'paid') continue;

      const item: DueItem = {
        key: `${room.id}|${period}`,
        room,
        period,
        dueDate: record.dueDate,
        daysUntilDue: daysBetween(today, record.dueDate),
        total: computeTotals(room.monthlyRent, record.electricity).total,
        electricityEntered: record.electricity !== '',
      };

      (item.daysUntilDue < 0 ? overdue : upcoming).push(item);
    }
  }

  const byDueDate = (a: DueItem, b: DueItem) =>
    a.dueDate.localeCompare(b.dueDate) ||
    a.room.boardingHouseId.localeCompare(b.room.boardingHouseId) ||
    a.room.roomName.localeCompare(b.room.roomName);

  upcoming.sort(byDueDate);
  overdue.sort(byDueDate);

  return { upcoming, overdue };
}