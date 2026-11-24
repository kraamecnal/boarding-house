export type BillEmailItem = {
  itemType: string
  description: string | null
  quantity: number
  unitPrice: number
  amount: number
}

export type FinalBillEmail = {
  billId: string
  tenantName: string | null
  tenantEmail: string
  roomName: string
  periodStart: string
  periodEnd: string
  dueDate: string
  totalAmount: number
  electricityCarriedForward: boolean
  items: BillEmailItem[]
}

export type SendResult =
  | { kind: 'sent'; attempts: number; messageId: string | null }
  | { kind: 'failed'; attempts: number; error: string; retryAt: string | null }
  | { kind: 'uncertain'; attempts: number; error: string }

const MAX_ATTEMPTS = 5
const MAX_REQUEST_ATTEMPTS = 3
const MAX_ERROR_BODY_LENGTH = 200

export function nonEmptyTenantEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]
  })
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function itemLabel(item: BillEmailItem): string {
  if (item.description) return item.description

  const labels: Record<string, string> = {
    rent: 'Room rent',
    water: 'Water',
    trash: 'Trash',
    wifi: 'Wi-Fi',
    electricity: 'Electricity',
    adjustment: 'Adjustment',
  }
  return labels[item.itemType] ?? item.itemType
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    15 * 60_000 * 2 ** Math.max(0, attemptCount - 1),
    4 * 60 * 60_000,
  )
}

export function retryAfterDate(header: string | null, fallbackMs: number): string {
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(Date.now() + seconds * 1_000).toISOString()
    }

    const timestamp = Date.parse(header)
    if (Number.isFinite(timestamp)) {
      return new Date(Math.max(timestamp, Date.now())).toISOString()
    }
  }

  return new Date(Date.now() + fallbackMs).toISOString()
}

function buildEmailContent(bill: FinalBillEmail): {
  subject: string
  textContent: string
  htmlContent: string
} {
  const rent = bill.items.filter((item) => item.itemType === 'rent')
  const fixed = bill.items.filter((item) =>
    ['water', 'trash', 'wifi'].includes(item.itemType)
  )
  const electricity = bill.items.filter((item) =>
    item.itemType === 'electricity' ||
    (item.itemType === 'adjustment' && item.description === 'Electricity')
  )
  const adjustments = bill.items.filter((item) =>
    item.itemType === 'adjustment' && item.description !== 'Electricity'
  )
  const fixedSubtotal = fixed.reduce((total, item) => total + item.amount, 0)
  const greeting = bill.tenantName ? `Hello ${bill.tenantName},` : 'Hello,'
  const textItems = [
    ...rent.map((item) => `${itemLabel(item)}: PHP ${money(item.amount)}`),
    ...fixed.map((item) => `${itemLabel(item)}: PHP ${money(item.amount)}`),
    `Fixed costs subtotal: PHP ${money(fixedSubtotal)}`,
    ...electricity.map((item) => `${itemLabel(item)}: PHP ${money(item.amount)}`),
    ...(bill.electricityCarriedForward && electricity.length === 0
      ? ['Electricity: carried forward to a later bill']
      : []),
    ...adjustments.map((item) => `${itemLabel(item)}: PHP ${money(item.amount)}`),
  ]

  const htmlRows = (items: BillEmailItem[]) => items.map((item) => (
    `<tr><td style="padding:8px 0;border-bottom:1px solid #D1D5DB">${escapeHtml(itemLabel(item))}</td>` +
    `<td style="padding:8px 0;border-bottom:1px solid #D1D5DB;text-align:right">PHP ${escapeHtml(money(item.amount))}</td></tr>`
  ))
  const fixedRow =
    `<tr><td style="padding:8px 0;font-weight:600">Fixed costs subtotal</td>` +
    `<td style="padding:8px 0;font-weight:600;text-align:right">PHP ${escapeHtml(money(fixedSubtotal))}</td></tr>`
  const carryForwardRow = bill.electricityCarriedForward && electricity.length === 0
    ? '<tr><td colspan="2" style="padding:8px 0;color:#64748B">Electricity was carried forward to a later bill.</td></tr>'
    : ''

  const subject = `Your final InKeeper bill for ${bill.periodStart} to ${bill.periodEnd}`
  const textContent = [
    greeting,
    '',
    `Room: ${bill.roomName}`,
    `Billing period: ${bill.periodStart} to ${bill.periodEnd}`,
    '',
    ...textItems,
    '',
    `Total: PHP ${money(bill.totalAmount)}`,
    `Due date: ${bill.dueDate}`,
  ].join('\n')
  const htmlContent = `
    <div style="max-width:640px;margin:0 auto;font-family:Arial,sans-serif;color:#1E293B">
      <h1 style="color:#1E3A8A;font-size:22px">InKeeper final bill</h1>
      <p>${escapeHtml(greeting)}</p>
      <p>Your bill for <strong>${escapeHtml(bill.roomName)}</strong> has been finalized.</p>
      <p><strong>Billing period:</strong> ${escapeHtml(bill.periodStart)} to ${escapeHtml(bill.periodEnd)}</p>
      <table style="width:100%;border-collapse:collapse">
        ${htmlRows(rent).join('')}
        ${htmlRows(fixed).join('')}
        ${fixedRow}
        ${htmlRows(electricity).join('')}
        ${carryForwardRow}
        ${htmlRows(adjustments).join('')}
        <tr>
          <td style="padding:12px 0;font-size:17px;font-weight:700">Total</td>
          <td style="padding:12px 0;font-size:17px;font-weight:700;text-align:right;color:#1E3A8A">PHP ${escapeHtml(money(bill.totalAmount))}</td>
        </tr>
      </table>
      <p><strong>Due date:</strong> ${escapeHtml(bill.dueDate)}</p>
    </div>
  `.trim()

  return { subject, textContent, htmlContent }
}

async function readResendError(response: Response): Promise<string> {
  const body = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_LENGTH)
  return body
    ? `Resend rejected the email request with HTTP ${response.status}: ${body}`
    : `Resend rejected the email request with HTTP ${response.status}.`
}

export async function sendEmail(
  resendKey: string,
  senderEmail: string,
  bill: FinalBillEmail,
  attemptCount: number,
): Promise<SendResult> {
  const { subject, textContent, htmlContent } = buildEmailContent(bill)
  const maxAttempts = Math.max(
    0,
    Math.min(MAX_REQUEST_ATTEMPTS, MAX_ATTEMPTS - attemptCount + 1),
  )

  for (let requestAttempt = 1; requestAttempt <= maxAttempts; requestAttempt += 1) {
    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: senderEmail,
          to: [bill.tenantEmail],
          subject,
          text: textContent,
          html: htmlContent,
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

    if (response.ok) {
      const payload = await response.json().catch(() => null) as {
        id?: unknown
      } | null
      return {
        kind: 'sent',
        attempts: requestAttempt,
        messageId: typeof payload?.id === 'string' ? payload.id : null,
      }
    }

    const error = await readResendError(response)
    if (response.status === 429) {
      const retryAt = retryAfterDate(
        response.headers.get('Retry-After'),
        retryDelayMs(attemptCount + requestAttempt - 1),
      )
      if (requestAttempt < maxAttempts) {
        const waitMs = Math.max(0, Date.parse(retryAt) - Date.now())
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }
      return {
        kind: 'failed',
        attempts: requestAttempt,
        error,
        retryAt,
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
