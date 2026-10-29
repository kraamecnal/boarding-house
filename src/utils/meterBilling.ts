import { getSupabaseClient } from '@/utils/supabase';

export type BillMeterReading = {
  id: string;
  value: number;
  readingAt: string;
};

export type BillMeterContext = {
  periodStart: string;
  periodEnd: string;
  readingDateValid: boolean;
  rate: number | null;
  isLocked: boolean;
  saved: boolean;
  previousReading: BillMeterReading | null;
  currentReading: BillMeterReading | null;
  usage: number | null;
  amount: number | null;
};

export type SavedBillMeterReading = {
  saved: true;
  electricityBilled: true;
  createdReading: boolean;
  previousReading: BillMeterReading;
  currentReading: BillMeterReading;
  usage: number;
  rate: number;
  amount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseReading(value: unknown, nullable: boolean): BillMeterReading | null {
  if (value === null && nullable) return null;
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.value !== 'number' ||
    !Number.isFinite(value.value) ||
    typeof value.readingAt !== 'string'
  ) {
    throw new Error('The bill meter details have an unexpected reading format.');
  }
  return { id: value.id, value: value.value, readingAt: value.readingAt };
}

export async function getBillMeterContext(
  billId: string,
  readingAt: string,
): Promise<BillMeterContext> {
  const { data, error } = await getSupabaseClient().rpc('get_bill_electricity_context', {
    p_bill_id: billId,
    p_reading_at: readingAt,
  });
  if (error) throw error;
  const result: unknown = data;
  if (
    !isRecord(result) ||
    typeof result.periodStart !== 'string' ||
    typeof result.periodEnd !== 'string' ||
    typeof result.readingDateValid !== 'boolean' ||
    (result.rate !== null && typeof result.rate !== 'number') ||
    typeof result.isLocked !== 'boolean' ||
    typeof result.saved !== 'boolean' ||
    (result.usage !== null && typeof result.usage !== 'number') ||
    (result.amount !== null && typeof result.amount !== 'number')
  ) {
    throw new Error('The bill meter details could not be loaded.');
  }
  return {
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    readingDateValid: result.readingDateValid,
    rate: result.rate,
    isLocked: result.isLocked,
    saved: result.saved,
    previousReading: parseReading(result.previousReading, true),
    currentReading: parseReading(result.currentReading, true),
    usage: result.usage,
    amount: result.amount,
  };
}

export async function saveBillMeterReading(
  billId: string,
  readingValue: number,
  readingAt: string,
): Promise<SavedBillMeterReading> {
  const { data, error } = await getSupabaseClient().rpc('record_bill_electricity_reading', {
    p_bill_id: billId,
    p_reading_value: readingValue,
    p_reading_at: readingAt,
  });
  if (error) throw error;
  const result: unknown = data;
  if (
    !isRecord(result) ||
    result.saved !== true ||
    result.electricityBilled !== true ||
    typeof result.createdReading !== 'boolean' ||
    typeof result.usage !== 'number' ||
    typeof result.rate !== 'number' ||
    typeof result.amount !== 'number'
  ) {
    throw new Error('The meter reading was not billed. Configure an electricity rate and try again.');
  }
  const previousReading = parseReading(result.previousReading, false);
  const currentReading = parseReading(result.currentReading, false);
  if (!previousReading || !currentReading) {
    throw new Error('The saved meter calculation is missing a reading.');
  }
  return {
    saved: true,
    electricityBilled: true,
    createdReading: result.createdReading,
    previousReading,
    currentReading,
    usage: result.usage,
    rate: result.rate,
    amount: result.amount,
  };
}
