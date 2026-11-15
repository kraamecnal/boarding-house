import {
  createClient,
  type SupabaseClient,
} from 'supabase'
import {
  addDays,
  escapeHtml,
  jwtRole,
  manilaDate,
  reminderTypeForDueDate,
  type ReminderType,
} from './reminder-logic.ts'

type ReminderStatus = 'sending' | 'sent' | 'failed' | 'uncertain'

type Database = {
 public: {
   Tables: {
     bill_reminders: {
       Row: {
         reminder_id: string
         bill_id: string
         reminder_type: ReminderType
         delivery_status: ReminderStatus
         attempt_count: number
         attempt_started_at: string | null
         next_attempt_at: string | null
         sent_at: string | null
         last_error: string | null
       }
       Insert: {
         reminder_id?: string
         bill_id: string
         reminder_type: ReminderType
         delivery_status?: ReminderStatus
         attempt_count?: number
         attempt_started_at?: string | null
         next_attempt_at?: string | null
         sent_at?: string | null
         last_error?: string | null
       }
       Update: Partial<Database['public']['Tables']['bill_reminders']['Insert']>
       Relationships: [{
         foreignKeyName: 'bill_reminders_bill_id_fkey'
         columns: ['bill_id']
         isOneToOne: false
         referencedRelation: 'monthly_bill'
         referencedColumns: ['bill_id']
       }]
     }
     monthly_bill: {
       Row: {
         bill_id: string
         tenancy_id: string
         due_date: string
         total_amount: number
         is_paid: boolean | null
         paid_at: string | null
       }
       Insert: {
         bill_id?: string
         tenancy_id: string
         due_date: string
         total_amount?: number
         is_paid?: boolean | null
         paid_at?: string | null
       }
       Update: Partial<Database['public']['Tables']['monthly_bill']['Insert']>
       Relationships: [{
         foreignKeyName: 'monthly_bill_tenancy_id_fkey'
         columns: ['tenancy_id']
         isOneToOne: false
         referencedRelation: 'tenancy'
         referencedColumns: ['tenancy_id']
       }]
     }
     tenancy: {
       Row: {
         tenancy_id: string
         tenant_id: string
       }
       Insert: {
         tenancy_id?: string
         tenant_id: string
       }
       Update: Partial<Database['public']['Tables']['tenancy']['Insert']>
       Relationships: [{
         foreignKeyName: 'fk_tenant_id'
         columns: ['tenant_id']
         isOneToOne: false
         referencedRelation: 'tenants'
         referencedColumns: ['tenant_id']
       }]
     }
     tenants: {
       Row: {
         tenant_id: string
         name: string | null
         email_address: string | null
       }
       Insert: {
         tenant_id?: string
         name?: string | null
         email_address?: string | null
       }
       Update: Partial<Database['public']['Tables']['tenants']['Insert']>
       Relationships: []
     }
   }
   Views: { [_ in never]: never }
   Functions: { [_ in never]: never }
   Enums: { reminder_type: ReminderType }
   CompositeTypes: { [_ in never]: never }
 }
}

type TenantsRelation = {
  email_address: string | null
  name: string | null
} | Array<{
  email_address: string | null
  name: string | null
}> | null

type TenancyRelation = {
  tenants: TenantsRelation
} | Array<{
  tenants: TenantsRelation
}> | null

type BillRow = {
  bill_id: string
  due_date: string
  total_amount: number | string
  is_paid: boolean | null
  paid_at: string | null
  tenancy: TenancyRelation
}

type ReminderRow = {
  reminder_id: string
  delivery_status: ReminderStatus
  attempt_count: number
  next_attempt_at: string | null
}

type Claim = {
  reminderId: string
  attemptCount: number
}

type SendResult =
  | { kind: 'sent'; attempts: number }
  | { kind: 'failed'; attempts: number; error: string; retryAt: string | null }
  | { kind: 'uncertain'; attempts: number; error: string }

const MAX_ATTEMPTS = 5
const MAX_REQUEST_ATTEMPTS = 3

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function firstRelation<T>(relation: T | T[] | null | undefined): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null
  return relation ?? null
}

function isDuplicateKeyError(error: { code?: string }): boolean {
  return error.code === '23505'
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(15 * 60_000 * 2 ** Math.max(0, attemptCount - 1), 4 * 60 * 60_000)
}

async function claimReminder(
  supabase: SupabaseClient<Database>,
  billId: string,
  reminderType: ReminderType,
  now: Date,
): Promise<Claim | null> {
  const nowIso = now.toISOString()
  const { data: inserted, error: insertError } = await supabase
    .from('bill_reminders')
    .insert({
      bill_id: billId,
      reminder_type: reminderType,
      delivery_status: 'sending',
      attempt_count: 1,
      attempt_started_at: nowIso,
    })
    .select('reminder_id, attempt_count')
    .maybeSingle()

  if (!insertError && inserted) {
    return { reminderId: inserted.reminder_id, attemptCount: inserted.attempt_count }
  }
  if (!insertError || !isDuplicateKeyError(insertError)) {
    throw new Error(`Could not claim reminder: ${insertError?.message ?? 'No row returned.'}`)
  }

  const { data: existing, error: readError } = await supabase
    .from('bill_reminders')
    .select('reminder_id, delivery_status, attempt_count, next_attempt_at')
    .eq('bill_id', billId)
    .eq('reminder_type', reminderType)
    .maybeSingle()

  if (readError) throw new Error(`Could not inspect reminder state: ${readError.message}`)
  if (!existing) throw new Error('Reminder uniqueness conflict did not return an existing row.')

  const reminder = existing as ReminderRow
  if (
    reminder.delivery_status !== 'failed' ||
    reminder.attempt_count >= MAX_ATTEMPTS ||
    !reminder.next_attempt_at ||
    Date.parse(reminder.next_attempt_at) > now.getTime()
  ) {
    return null
  }

  const nextAttemptCount = reminder.attempt_count + 1
  const { data: claimed, error: claimError } = await supabase
    .from('bill_reminders')
    .update({
      delivery_status: 'sending',
      attempt_count: nextAttemptCount,
      attempt_started_at: nowIso,
      next_attempt_at: null,
      last_error: null,
    })
    .eq('reminder_id', reminder.reminder_id)
    .eq('delivery_status', 'failed')
    .eq('attempt_count', reminder.attempt_count)
    .lte('next_attempt_at', nowIso)
    .select('reminder_id')
    .maybeSingle()

  if (claimError) throw new Error(`Could not retry reminder: ${claimError.message}`)
  return claimed ? { reminderId: claimed.reminder_id, attemptCount: nextAttemptCount } : null
}

async function sendEmail(
  brevoKey: string,
  senderEmail: string,
  recipientEmail: string,
  recipientName: string | null,
  amount: string,
  dueDate: string,
  reminderType: ReminderType,
  attemptCount: number,
): Promise<SendResult> {
  const recipient = recipientName
    ? { email: recipientEmail, name: recipientName }
    : { email: recipientEmail }
  const dueDescription =
    reminderType === 'two_days_before' ? 'is due in two days' : 'is due today'
  const subject =
    reminderType === 'two_days_before'
      ? 'Your monthly bill is due in two days'
      : 'Your monthly bill is due today'
  const safeName = recipientName ? escapeHtml(recipientName) : 'there'
  const textContent = `Hello${recipientName ? ` ${recipientName}` : ''}, your bill of PHP ${amount} ${dueDescription} (${dueDate}).`
  const htmlContent = `<p>Hello ${safeName},</p><p>Your bill of PHP ${amount} ${dueDescription} (${dueDate}).</p>`
  const maxAttempts = Math.min(MAX_REQUEST_ATTEMPTS, MAX_ATTEMPTS - attemptCount + 1)

  for (let requestAttempt = 1; requestAttempt <= maxAttempts; requestAttempt += 1) {
    let response: Response
    try {
      response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'Inkeeper', email: senderEmail },
          to: [recipient],
          subject,
          textContent,
          htmlContent,
        }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      return {
        kind: 'uncertain',
        attempts: requestAttempt,
        error: error instanceof Error ? error.message : 'Email request outcome is unknown.',
      }
    }

    if (response.ok) return { kind: 'sent', attempts: requestAttempt }

    if (response.status === 429 && requestAttempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (requestAttempt - 1)))
      continue
    }

    const error = `Brevo rejected the email request with HTTP ${response.status}.`
    if (response.status === 429) {
      return {
        kind: 'failed',
        attempts: requestAttempt,
        error,
        retryAt: new Date(Date.now() + retryDelayMs(attemptCount + requestAttempt - 1)).toISOString(),
      }
    }
    if (response.status === 408 || response.status >= 500) {
      return { kind: 'uncertain', attempts: requestAttempt, error }
    }
    return { kind: 'failed', attempts: requestAttempt, error, retryAt: null }
  }

  return {
    kind: 'failed',
    attempts: maxAttempts,
    error: 'Email retry limit reached.',
    retryAt: null,
  }
}

async function updateReminder(
  supabase: SupabaseClient<Database>,
  claim: Claim,
  result: SendResult,
): Promise<void> {
  const attemptCount = claim.attemptCount + result.attempts - 1
  const update: Database['public']['Tables']['bill_reminders']['Update'] =
    result.kind === 'sent'
      ? {
          delivery_status: 'sent',
          attempt_count: attemptCount,
          sent_at: new Date().toISOString(),
          next_attempt_at: null,
          last_error: null,
        }
      : {
          delivery_status: result.kind,
          attempt_count: attemptCount,
          sent_at: null,
          next_attempt_at: result.kind === 'failed' ? result.retryAt : null,
          last_error: result.error.slice(0, 500),
        }

  const { data, error } = await supabase
    .from('bill_reminders')
    .update(update)
    .eq('reminder_id', claim.reminderId)
    .eq('delivery_status', 'sending')
    .select('reminder_id')
    .maybeSingle()

  if (error) throw new Error(`Could not record reminder result: ${error.message}`)
  if (!data) throw new Error('Reminder claim was lost before recording its result.')
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  if (jwtRole(request.headers.get('authorization')) !== 'service_role') {
    return jsonResponse({ error: 'Unauthorized.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const brevoKey = Deno.env.get('BREVO_API_KEY')
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL')
  if (!supabaseUrl || !serviceRoleKey || !brevoKey || !senderEmail) {
    console.error('Bill reminder delivery is missing required server configuration.')
    return jsonResponse({ error: 'Bill reminder delivery is not configured.' }, 500)
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const today = manilaDate(new Date())
  const twoDaysAhead = addDays(today, 2)
  const { data, error } = await supabase
    .from('monthly_bill')
    .select('bill_id, due_date, total_amount, is_paid, paid_at, tenancy(tenancy_id, tenants(email_address, name))')
    .in('due_date', [today, twoDaysAhead])
    .is('paid_at', null)
    .or('is_paid.is.null,is_paid.eq.false')

  if (error) {
    console.error('Could not load eligible bills for reminders:', error.message)
    return jsonResponse({ error: 'Could not load eligible bills.' }, 500)
  }

  let sent = 0
  let failed = 0
  let uncertain = 0
  let skipped = 0

  for (const bill of (data ?? []) as BillRow[]) {
    if (bill.is_paid === true || bill.paid_at !== null) {
      skipped += 1
      continue
    }

    const reminderType = reminderTypeForDueDate(bill.due_date, today)
    if (!reminderType) {
      skipped += 1
      continue
    }

    const tenancy = firstRelation(bill.tenancy)
    const tenant = firstRelation(tenancy?.tenants)
    const recipientEmail = tenant?.email_address?.trim()
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      console.error(`Skipping bill ${bill.bill_id}: tenant email is missing or invalid.`)
      skipped += 1
      continue
    }

    const numericAmount = Number(bill.total_amount)
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      console.error(`Skipping bill ${bill.bill_id}: bill amount is invalid.`)
      skipped += 1
      continue
    }

    let claim: Claim | null
    try {
      claim = await claimReminder(supabase, bill.bill_id, reminderType, new Date())
    } catch (claimError) {
      console.error(
        `Could not claim reminder for bill ${bill.bill_id}:`,
        claimError instanceof Error ? claimError.message : claimError,
      )
      failed += 1
      continue
    }

    if (!claim) {
      skipped += 1
      continue
    }

    const amount = new Intl.NumberFormat('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericAmount)
    const result = await sendEmail(
      brevoKey,
      senderEmail,
      recipientEmail,
      tenant?.name?.trim() || null,
      amount,
      bill.due_date,
      reminderType,
      claim.attemptCount,
    )

    try {
      await updateReminder(supabase, claim, result)
    } catch (updateError) {
      console.error(
        `Could not record reminder result for bill ${bill.bill_id}:`,
        updateError instanceof Error ? updateError.message : updateError,
      )
      failed += 1
      continue
    }

    if (result.kind === 'sent') {
      sent += 1
    } else if (result.kind === 'uncertain') {
      console.error(`Reminder delivery outcome is uncertain for bill ${bill.bill_id}:`, result.error)
      uncertain += 1
    } else {
      console.error(`Reminder delivery failed for bill ${bill.bill_id}:`, result.error)
      failed += 1
    }
  }

  return jsonResponse({ checked: data?.length ?? 0, sent, failed, uncertain, skipped })
})
