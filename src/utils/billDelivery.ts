import { getSupabaseClient } from '@/utils/supabase';

export type BillDeliveryResult =
  | {
      kind: 'sent';
      finalized?: boolean;
      resent?: boolean;
      messageId: string | null;
    }
  | {
      kind: 'no_email';
      finalized?: boolean;
      resent?: boolean;
    }
  | {
      kind: 'failed' | 'uncertain';
      finalized?: boolean;
      resent?: boolean;
      error: string | null;
      retryAt: string | null;
      message?: string;
    };

function requestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function parseResult(value: unknown): BillDeliveryResult {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new Error('The bill delivery response has an unexpected format.');
  }

  if (value.kind === 'no_email') return value as BillDeliveryResult;
  if (
    value.kind === 'sent' &&
    (!('messageId' in value) ||
      (value.messageId !== null && typeof value.messageId !== 'string'))
  ) {
    throw new Error('The bill delivery response is missing its message ID state.');
  }
  if (
    (value.kind === 'failed' || value.kind === 'uncertain') &&
    (!('error' in value) || !('retryAt' in value))
  ) {
    throw new Error('The failed bill delivery response is incomplete.');
  }
  if (!['sent', 'no_email', 'failed', 'uncertain'].includes(String(value.kind))) {
    throw new Error('The bill delivery response has an unknown result.');
  }

  return value as BillDeliveryResult;
}

async function invoke(functionName: string, billId: string): Promise<BillDeliveryResult> {
  const { data, error } = await getSupabaseClient().functions.invoke(functionName, {
    body: {
      bill_id: billId,
      request_id: requestId(),
    },
  });
  if (error) throw error;
  return parseResult(data);
}

export function finalizeAndSendBill(billId: string): Promise<BillDeliveryResult> {
  return invoke('finalize-tenant-bill', billId);
}

export function resendFinalBill(billId: string): Promise<BillDeliveryResult> {
  return invoke('resend-tenant-bill', billId);
}

export function billDeliveryMessage(result: BillDeliveryResult): string {
  switch (result.kind) {
    case 'sent':
      return 'The final bill was emailed successfully.';
    case 'no_email':
      return 'The bill was finalized. No email is on file for this tenant.';
    case 'uncertain':
      return 'The bill was finalized, but email delivery is uncertain. Do not resend automatically.';
    case 'failed':
      return result.retryAt
        ? `The email was not sent and may be retried after ${result.retryAt}.`
        : 'The bill was finalized, but the email was not sent.';
  }
}
