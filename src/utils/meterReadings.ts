import { getSupabaseClient } from '@/utils/supabase';

export type MeterReading = {
  id: string;
  roomId: string;
  value: number;
  readingAt: string;
  createdAt: string;
};

type MeterReadingRow = {
  reading_id: string;
  room_id: string;
  reading_value: number;
  reading_at: string;
  created_at: string;
};

function mapReading(row: MeterReadingRow): MeterReading {
  return {
    id: row.reading_id,
    roomId: row.room_id,
    value: Number(row.reading_value),
    readingAt: row.reading_at,
    createdAt: row.created_at,
  };
}

export async function getRoomMeterReadings(roomId: string): Promise<MeterReading[]> {
  const { data, error } = await getSupabaseClient()
    .from('meter_readings')
    .select('reading_id, room_id, reading_value, reading_at, created_at')
    .eq('room_id', roomId)
    .order('reading_at', { ascending: false })
    .order('reading_id', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as MeterReadingRow[]).map(mapReading);
}

export async function recordRoomMeterReading(
  roomId: string,
  value: number,
  readingAt: string,
): Promise<MeterReading> {
  if (!Number.isFinite(value) || value < 0 || !isValidIsoDate(readingAt)) {
    throw new Error('Enter a valid nonnegative meter reading and reading date.');
  }

  const { data, error } = await getSupabaseClient()
    .from('meter_readings')
    .insert({
      room_id: roomId,
      reading_value: value,
      reading_at: readingAt,
    })
    .select('reading_id, room_id, reading_value, reading_at, created_at')
    .single();

  if (error) throw error;
  return mapReading(data as MeterReadingRow);
}

export function meterReadingErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === '23505') {
      return 'A reading already exists for this date or billing cycle.';
    }
    if (error.code === '42501') {
      return 'You are not authorized to change readings for this room.';
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('billing cycle')) {
      return 'A meter reading has already been recorded for this billing cycle.';
    }
    if (message.includes('earlier than the previous')) {
      return 'The reading date cannot be earlier than the previous meter reading.';
    }
    if (message.includes('lower than the previous')) {
      return 'The reading cannot be lower than the previous meter reading.';
    }
    return error.message;
  }

  return fallback;
}

export function sanitizeMeterReadingInput(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, '');
  const decimalIndex = cleaned.indexOf('.');
  if (decimalIndex < 0) return cleaned;
  return `${cleaned.slice(0, decimalIndex)}.${cleaned
    .slice(decimalIndex + 1)
    .replace(/\./g, '')}`;
}

export function parseMeterReadingInput(text: string): number | null {
  const value = text.trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
}

export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateFromLocalIso(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function cycleDate(anchorIso: string, targetIso: string): string {
  const [, , anchorDay] = anchorIso.split('-').map(Number);
  const [targetYear, targetMonth] = targetIso.split('-').map(Number);
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  const day = Math.min(anchorDay, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function hasReadingInBillingCycle(
  anchorDate: string,
  readingDate: string,
  readings: MeterReading[],
): boolean {
  if (readingDate < anchorDate) return false;
  const cycleStart = cycleDate(anchorDate, readingDate);
  return readings.some(
    (reading) =>
      reading.readingAt >= anchorDate &&
      cycleDate(anchorDate, reading.readingAt) === cycleStart,
  );
}
