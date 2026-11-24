export {
  manilaDateFromTimestamp,
  paymentTimestampForDate,
  todayInManila,
} from '@/utils/manilaDate';

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
