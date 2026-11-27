import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Keep false so it only emails unpaid, finalized bills due within 3 days or overdue
const TEST_MODE = false

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVER_API_SECRET')
  const resendKey = Deno.env.get('RESEND_API_KEY')

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'Missing Supabase URL or Service Role secret' }, 500)
  }
  if (!resendKey) {
    return jsonResponse({ error: 'Missing RESEND_API_KEY secret' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Philippine Time (UTC+8)
  const nowManila = new Date(Date.now() + 8 * 3600 * 1000)
  const todayStr = nowManila.toISOString().slice(0, 10)
  const threeDaysAheadStr = new Date(nowManila.getTime() + 3 * 86400000).toISOString().slice(0, 10)

  let query = supabase
    .from('monthly_bill')
    .select(`
      bill_id,
      due_date,
      total_amount,
      is_paid,
      billed_at,
      tenancy!inner(
        tenancy_id,
        tenants(email_address, name),
        rooms(room_name, boarding_house(name))
      )
    `)

  if (!TEST_MODE) {
    query = query
      .eq('is_paid', false)
      .not('billed_at', 'is', null)
      .lte('due_date', threeDaysAheadStr)
  }

  const { data: bills, error } = await query

  if (error) {
    return jsonResponse({ step: 'supabase_query', error: error.message }, 500)
  }

  let sentCount = 0
  const debugLogs: Record<string, unknown>[] = []

  for (const bill of bills ?? []) {
    const tenancy = firstRelation(bill.tenancy)
    const tenant = firstRelation(tenancy?.tenants)
    const room = firstRelation(tenancy?.rooms)
    const boardingHouse = firstRelation(room?.boarding_house)

    const email = tenant?.email_address
    if (!email) {
      debugLogs.push({ bill_id: bill.bill_id, status: 'skipped_no_email' })
      continue
    }

    const dueDateStr = String(bill.due_date).slice(0, 10)
    const isOverdue = dueDateStr < todayStr
    const propertyLabel = [boardingHouse?.name, room?.room_name].filter(Boolean).join(' - ')

    const subject = isOverdue
      ? `Overdue Bill Reminder${propertyLabel ? ` (${propertyLabel})` : ''}`
      : `Upcoming Bill Reminder${propertyLabel ? ` (${propertyLabel})` : ''}`

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Inkeeper <billing@innk3eper.xyz>',
        to: [email],
        subject,
        html: `
          <p>Hi ${tenant?.name || 'there'},</p>
          <p>Your bill${propertyLabel ? ` for <strong>${propertyLabel}</strong>` : ''} of <strong>₱${bill.total_amount}</strong> is ${
            isOverdue ? '<strong>now overdue</strong>' : `due on <strong>${dueDateStr}</strong>`
          }.</p>
          <p>Please settle it as soon as possible. Thank you!</p>
        `,
      }),
    })

    if (emailResponse.ok) {
      sentCount++
      debugLogs.push({ bill_id: bill.bill_id, status: 'sent', email })
    } else {
      const errorBody = await emailResponse.text()
      debugLogs.push({
        bill_id: bill.bill_id,
        status: 'resend_failed',
        code: emailResponse.status,
        error: errorBody,
      })
    }

    // Pace requests to stay under Resend's 2 emails/second rate limit
    await sleep(600)
  }

  return jsonResponse({
    checked: bills?.length ?? 0,
    sent: sentCount,
    todayManila: todayStr,
    debugLogs,
  })
})
