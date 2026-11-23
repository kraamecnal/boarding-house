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

export function paymentUpdateErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : '';
  if (
    message.includes('carry-forward is completed') ||
    message.includes('carry-forward')
  ) {
    return 'This bill cannot be marked paid until its electricity carry-forward is completed.';
  }
  if (message.includes('generated column')) {
    return 'This bill could not be updated because its paid status is system-generated.';
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === '42501') {
      return 'You are not authorized to update this bill.';
    }
  }
  if (message) return message;
  return 'Could not record this payment. Please check your connection and try again.';
}
