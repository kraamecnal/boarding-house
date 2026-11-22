import { createClient, type SupabaseClient } from 'supabase'
import {
  addDays,
  manilaDate,
  ownerReminderContent,
  secretMatches,
  type ReminderType,
} from './reminder-logic.ts'

type RoomRelation = {
  room_id: string
  room_name: string
  boarding_house_id: string
  boarding_house: { owner_id: string } | Array<{ owner_id: string }> | null
} | Array<{
  room_id: string
  room_name: string
  boarding_house_id: string
  boarding_house: { owner_id: string } | Array<{ owner_id: string }> | null
}> | null

type TenancyRelation = {
  owner_id: string
  rooms: RoomRelation
} | Array<{
  owner_id: string
  rooms: RoomRelation
}> | null

type BillRow = {
  bill_id: string
  period_start: string
  due_date: string
  tenancy: TenancyRelation
}

type ClaimedReminder = {
  reminder_id: string
}

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

async function claimReminder(
  supabase: SupabaseClient,
  billId: string,
  reminderType: ReminderType,
  reminderDay: string,
): Promise<ClaimedReminder | null> {
  const { data, error } = await supabase
    .from('bill_reminders')
    .insert({
      bill_id: billId,
      reminder_type: reminderType,
      reminder_day: reminderDay,
      delivery_status: 'pending',
      attempt_count: 1,
      attempt_started_at: new Date().toISOString(),
    })
    .select('reminder_id')
    .maybeSingle()

  if (!error && data) return data as ClaimedReminder
  if (error && isDuplicateKeyError(error)) return null
  throw new Error(`Could not claim owner reminder: ${error?.message ?? 'No row returned.'}`)
}

async function markReminder(
  supabase: SupabaseClient,
  reminderId: string,
  status: 'sent' | 'failed',
  errorMessage: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from('bill_reminders')
    .update(
      status === 'sent'
        ? {
            delivery_status: 'sent',
            sent_at: new Date().toISOString(),
            last_error: null,
            retry_at: null,
          }
        : {
            delivery_status: 'failed',
            sent_at: null,
            retry_at: null,
            last_error: errorMessage?.slice(0, 500) ?? 'Owner notification delivery failed.',
          },
    )
    .eq('reminder_id', reminderId)

  if (error) throw new Error(`Could not record owner reminder result: ${error.message}`)
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  const expectedCronToken = Deno.env.get('BILL_REMINDERS_CRON_TOKEN')
  if (
    !expectedCronToken ||
    !secretMatches(
      request.headers.get('x-bill-reminders-cron-token'),
      expectedCronToken,
    )
  ) {
    return jsonResponse({ error: 'Unauthorized.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serverApiSecret = Deno.env.get('SERVER_API_SECRET')
  if (!supabaseUrl || !serverApiSecret) {
    console.error('Owner bill reminders are missing required server configuration.')
    return jsonResponse({ error: 'Owner reminder delivery is not configured.' }, 500)
  }

  const supabase = createClient(supabaseUrl, serverApiSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const today = manilaDate(new Date())
  const twoDaysAhead = addDays(today, 2)
  const { data, error } = await supabase
    .from('monthly_bill')
    .select(
      'bill_id, period_start, due_date, tenancy!inner(owner_id, rooms!inner(room_id, room_name, boarding_house_id, boarding_house!inner(owner_id)))',
    )
    .is('billed_at', null)
    .lte('due_date', twoDaysAhead)

  if (error) {
    console.error('Could not load bills needing owner reminders:', error.message)
    return jsonResponse({ error: 'Could not load eligible bills.' }, 500)
  }

  let notified = 0
  let failed = 0
  let skipped = 0

  for (const bill of (data ?? []) as BillRow[]) {
    const tenancy = firstRelation(bill.tenancy)
    const room = firstRelation(tenancy?.rooms)
    const boardingHouse = firstRelation(room?.boarding_house)
    const content = ownerReminderContent(room?.room_name ?? 'this room', bill.due_date, today)

    if (
      !content ||
      !tenancy?.owner_id ||
      !room ||
      !boardingHouse ||
      boardingHouse.owner_id !== tenancy.owner_id
    ) {
      skipped += 1
      continue
    }

    let claim: ClaimedReminder | null
    try {
      claim = await claimReminder(
        supabase,
        bill.bill_id,
        content.type,
        today,
      )
    } catch (claimError) {
      console.error(
        `Could not claim owner reminder for bill ${bill.bill_id}:`,
        claimError instanceof Error ? claimError.message : claimError,
      )
      failed += 1
      continue
    }

    if (!claim) {
      skipped += 1
      continue
    }

    const eventKey = `owner-reading:${content.type}:${bill.bill_id}:${today}`
    const { error: notificationError } = await supabase
      .from('notifications')
      .upsert(
        {
          owner_id: tenancy.owner_id,
          event_key: eventKey,
          type: 'meter_reading_required',
          title: content.title,
          message: content.message,
          related_bill_id: bill.bill_id,
          data: {
            room_id: room.room_id,
            boarding_house_id: room.boarding_house_id,
            period: bill.period_start.slice(0, 7),
            reminder_type: content.type,
            reminder_day: today,
          },
        },
        {
          onConflict: 'owner_id,event_key',
          ignoreDuplicates: true,
        },
      )

    if (notificationError) {
      console.error(
        `Could not create owner reminder notification for bill ${bill.bill_id}:`,
        notificationError.message,
      )
      try {
        await markReminder(supabase, claim.reminder_id, 'failed', notificationError.message)
      } catch (recordError) {
        console.error(
          `Could not record owner reminder failure for bill ${bill.bill_id}:`,
          recordError instanceof Error ? recordError.message : recordError,
        )
      }
      failed += 1
      continue
    }

    try {
      await markReminder(supabase, claim.reminder_id, 'sent')
      notified += 1
    } catch (recordError) {
      console.error(
        `Could not record owner reminder delivery for bill ${bill.bill_id}:`,
        recordError instanceof Error ? recordError.message : recordError,
      )
      failed += 1
    }
  }

  return jsonResponse({
    checked: data?.length ?? 0,
    notified,
    failed,
    skipped,
    reminderDay: today,
  })
})
