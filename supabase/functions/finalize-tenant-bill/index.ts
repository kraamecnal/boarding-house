import { createClient, type SupabaseClient } from 'supabase'
import {
  sendEmail,
  nonEmptyTenantEmail,
  type BillEmailItem,
  type FinalBillEmail,
  type SendResult,
} from '../_shared/bill-email.ts'

type Preparation = {
  kind: 'pending' | 'no_email'
  reminderId: string
  bill: {
    billId: string
    tenantName: string | null
    tenantEmail: string | null
    roomName: string
    periodStart: string
    periodEnd: string
    dueDate: string
    billedAt: string | null
    totalAmount: number
    electricityCarriedForward: boolean
    items: BillEmailItem[]
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  return authorization.slice('Bearer '.length).trim() || null
}

function parsePreparation(value: unknown): Preparation {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    !('reminderId' in value) ||
    !('bill' in value) ||
    (value.kind !== 'pending' && value.kind !== 'no_email') ||
    typeof value.reminderId !== 'string' ||
    typeof value.bill !== 'object' ||
    value.bill === null
  ) {
    throw new Error('The finalization response has an unexpected format.')
  }

  const bill = value.bill as Record<string, unknown>
  if (
    typeof bill.billId !== 'string' ||
    (bill.tenantName !== null && typeof bill.tenantName !== 'string') ||
    (bill.tenantEmail !== null && typeof bill.tenantEmail !== 'string') ||
    typeof bill.roomName !== 'string' ||
    typeof bill.periodStart !== 'string' ||
    typeof bill.periodEnd !== 'string' ||
    typeof bill.dueDate !== 'string' ||
    typeof bill.totalAmount !== 'number' ||
    typeof bill.electricityCarriedForward !== 'boolean' ||
    !Array.isArray(bill.items)
  ) {
    throw new Error('The finalized bill payload is incomplete.')
  }

  return value as Preparation
}

async function recordResult(
  supabase: SupabaseClient,
  reminderId: string,
  startingAttempt: number,
  result: SendResult,
): Promise<void> {
  const attemptCount = startingAttempt + result.attempts - 1
  const { data, error } = await supabase
    .from('bill_reminders')
    .update(
      result.kind === 'sent'
        ? {
            delivery_status: 'sent',
            attempt_count: attemptCount,
            sent_at: new Date().toISOString(),
            retry_at: null,
            last_error: null,
            message_id: result.messageId,
          }
        : {
            delivery_status: result.kind,
            attempt_count: attemptCount,
            sent_at: null,
            retry_at: result.kind === 'failed' ? result.retryAt : null,
            last_error: result.error.slice(0, 500),
            message_id: null,
          },
    )
    .eq('reminder_id', reminderId)
    .eq('delivery_status', 'pending')
    .select('reminder_id')
    .maybeSingle()

  if (error) throw new Error(`Could not record bill email result: ${error.message}`)
  if (!data) throw new Error('The pending bill email claim was not found.')
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  const token = bearerToken(request)
  if (!token) {
    return jsonResponse({ error: 'Authentication is required.' }, 401)
  }

  let payload: { bill_id?: unknown; request_id?: unknown }
  try {
    payload = await request.json()
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400)
  }
  if (
    typeof payload.bill_id !== 'string' ||
    typeof payload.request_id !== 'string'
  ) {
    return jsonResponse({ error: 'bill_id and request_id are required.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serverApiSecret = Deno.env.get('SERVER_API_SECRET')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const senderEmail = Deno.env.get('RESEND_SENDER_EMAIL') ??
    'InKeeper <billing@innk3eper.xyz>'
  if (!supabaseUrl || !serverApiSecret || !resendKey) {
    console.error('Final bill delivery is missing required server configuration.')
    return jsonResponse({ error: 'Bill email delivery is not configured.' }, 500)
  }

  const serviceClient = createClient(supabaseUrl, serverApiSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData, error: authError } = await serviceClient.auth.getUser(token)
  if (authError || !userData.user) {
    return jsonResponse({ error: 'Authentication is invalid.' }, 401)
  }

  const userClient = createClient(supabaseUrl, serverApiSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await userClient.rpc('finalize_tenant_bill', {
    p_bill_id: payload.bill_id,
    p_request_id: payload.request_id,
  })
  if (error) {
    return jsonResponse({ error: error.message }, error.code === '23505' ? 409 : 400)
  }

  let preparation: Preparation
  try {
    preparation = parsePreparation(data)
  } catch (parseError) {
    console.error(
      'Final bill preparation returned invalid data:',
      parseError instanceof Error ? parseError.message : parseError,
    )
    return jsonResponse({ error: 'Could not prepare the final bill.' }, 500)
  }

  const tenantEmail = nonEmptyTenantEmail(preparation.bill.tenantEmail)
  if (preparation.kind === 'no_email' || !tenantEmail) {
    return jsonResponse({
      kind: 'no_email',
      finalized: true,
      sent: false,
    })
  }

  const email: FinalBillEmail = {
    ...preparation.bill,
    tenantEmail,
  }
  const result = await sendEmail(resendKey, senderEmail, email, 1)
  try {
    await recordResult(serviceClient, preparation.reminderId, 1, result)
  } catch (recordError) {
    console.error(
      'Could not persist final bill delivery result:',
      recordError instanceof Error ? recordError.message : recordError,
    )
    return jsonResponse(
      {
        kind: 'uncertain',
        finalized: true,
        retryAt: null,
        error: 'The bill was finalized, but its email delivery result could not be recorded.',
      },
      502,
    )
  }

  return jsonResponse({
    kind: result.kind,
    finalized: true,
    messageId: result.kind === 'sent' ? result.messageId : null,
    retryAt: result.kind === 'failed' ? result.retryAt : null,
    error: result.kind === 'sent' ? null : result.error,
  })
})
