const MANILA_TIME_ZONE = 'Asia/Manila';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatPartsAsIso(date: Date): string {
  const parts = dateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Could not determine the date in Asia/Manila.');
  }
  return `${year}-${month}-${day}`;
}

export function todayInManila(now = new Date()): string {
  return formatPartsAsIso(now);
}

export function manilaDateFromTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatPartsAsIso(date);
}

export function paymentTimestampForDate(paymentDate: string, now = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw new Error('Choose a valid payment date.');
  }
  return paymentDate === todayInManila(now)
    ? now.toISOString()
    : `${paymentDate}T12:00:00+08:00`;
}
