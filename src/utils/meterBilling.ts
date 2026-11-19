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

export type BillElectricityRollForward = {
  targetBillId: string;
  targetPeriodStart: string;
  status: 'pending' | 'completed';
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

export async function carryForwardBillElectricity(
  sourceBillId: string,
): Promise<BillElectricityRollForward> {
  const { data, error } = await getSupabaseClient().rpc('carry_forward_bill_electricity', {
    p_source_bill_id: sourceBillId,
  });
  if (error) throw error;

  const result: unknown = data;
  if (
    !isRecord(result) ||
    typeof result.targetBillId !== 'string' ||
    typeof result.targetPeriodStart !== 'string' ||
    (result.status !== 'pending' && result.status !== 'completed')
  ) {
    throw new Error('The carry-forward response has an unexpected format.');
  }
  return {
    targetBillId: result.targetBillId,
    targetPeriodStart: result.targetPeriodStart,
    status: result.status,
  };
}

export async function cancelBillElectricityRollForward(sourceBillId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('cancel_bill_electricity_roll_forward', {
    p_source_bill_id: sourceBillId,
  });
  if (error) throw error;
}

export function billMeterErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;

  const message = error.message.toLowerCase();
  if (
    message.includes('reading date must be later than the previous reading') ||
    message.includes('current reading must be later')
  ) {
    return 'A later meter reading is already recorded, so this historical reading cannot be added safely. No readings were changed. Use Carry Forward instead.';
  }
  if (message.includes('resolve earlier electricity readings')) {
    return 'Resolve the earlier bill first: enter a real reading from that period, or explicitly carry its usage forward.';
  }
  if (message.includes('there is no later generated bill')) {
    return 'A later bill has not been generated yet, so this usage cannot be carried forward.';
  }
  if (message.includes('later bill already has a manual electricity charge')) {
    return 'The later bill already has a manual electricity charge, so usage cannot be carried forward to it.';
  }
  if (message.includes('a reading already exists in this bill period')) {
    return 'A meter reading already exists in this period. Use the late-reading option instead of carrying it forward.';
  }
  if (message.includes('already attached to another bill')) {
    return 'This meter reading is already included on another bill, so it cannot be added again.';
  }
  if (message.includes('a different meter reading is already saved for this date')) {
    return 'A different meter value is already recorded on this date. No readings were changed.';
  }
  if (message.includes('does not contain the full missed-period')) {
    return 'The later bill’s reading interval does not cover this entire period, so it cannot be carried forward safely.';
  }
  if (message.includes('reading interval does not cover')) {
    return 'The later bill’s reading interval does not cover this entire period, so it cannot be carried forward safely.';
  }
  if (message.includes('opening reading before this bill period')) {
    return 'An opening meter reading before this bill period is required before usage can be carried forward.';
  }
  if (message.includes('cannot be cancelled safely')) {
    return 'A later meter reading already exists. The carry-forward cannot be cancelled without changing the reading sequence.';
  }
  if (message.includes('issued or paid bill cannot be changed')) {
    return 'An issued or paid bill cannot be changed by this action. A separate adjustment is needed.';
  }
  return error.message;
}
