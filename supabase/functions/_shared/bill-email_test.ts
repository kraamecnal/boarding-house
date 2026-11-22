import {
  nonEmptyTenantEmail,
  sendEmail,
  type FinalBillEmail,
} from './bill-email.ts'

const bill: FinalBillEmail = {
  billId: 'bill-1',
  tenantName: 'Guest <One>',
  tenantEmail: 'tenant@example.com',
  roomName: 'Room 3 & Annex',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  dueDate: '2026-12-05',
  totalAmount: 3500,
  electricityCarriedForward: false,
  items: [
    { itemType: 'rent', description: null, quantity: 1, unitPrice: 2500, amount: 2500 },
    { itemType: 'water', description: null, quantity: 1, unitPrice: 300, amount: 300 },
    { itemType: 'trash', description: null, quantity: 1, unitPrice: 100, amount: 100 },
    { itemType: 'wifi', description: null, quantity: 1, unitPrice: 600, amount: 600 },
  ],
}

async function withFetch(
  replacement: typeof fetch,
  callback: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = replacement
  try {
    await callback()
  } finally {
    globalThis.fetch = original
  }
}

Deno.test('successful Brevo parse failures still report sent with no message ID', async () => {
  await withFetch(
    async () => new Response('not-json', { status: 201 }),
    async () => {
      const result = await sendEmail('key', 'sender@example.com', bill, 1)
      if (result.kind !== 'sent' || result.messageId !== null || result.attempts !== 1) {
        throw new Error('Expected a successful response with an unknown message ID.')
      }
    },
  )
})

Deno.test('successful Brevo responses capture message IDs', async () => {
  await withFetch(
    async () => Response.json({ messageId: 'brevo-message-1' }),
    async () => {
      const result = await sendEmail('key', 'sender@example.com', bill, 1)
      if (result.kind !== 'sent' || result.messageId !== 'brevo-message-1') {
        throw new Error('Expected the Brevo message ID to be retained.')
      }
    },
  )
})

Deno.test('Brevo 429 retries honor Retry-After', async () => {
  let requests = 0
  await withFetch(
    async () => {
      requests += 1
      return requests === 1
        ? new Response('rate limited', {
            status: 429,
            headers: { 'Retry-After': '0' },
          })
        : Response.json({ messageId: 'retry-message' })
    },
    async () => {
      const result = await sendEmail('key', 'sender@example.com', bill, 1)
      if (result.kind !== 'sent' || result.attempts !== 2 || requests !== 2) {
        throw new Error('Expected one 429 retry before success.')
      }
    },
  )
})

Deno.test('non-retryable Brevo failures return failed with bounded diagnostics', async () => {
  const body = 'x'.repeat(1000)
  await withFetch(
    async () => new Response(body, { status: 400 }),
    async () => {
      const result = await sendEmail('key', 'sender@example.com', bill, 1)
      if (result.kind !== 'failed' || result.retryAt !== null) {
        throw new Error('Expected a terminal failed result.')
      }
      if (result.error.length > 260 || !result.error.includes('HTTP 400')) {
        throw new Error('Expected a short diagnostic containing the status.')
      }
    },
  )
})

Deno.test('timeouts, 5xx, and network failures return uncertain', async () => {
  for (const status of [408, 500, 503]) {
    await withFetch(
      async () => new Response('delivery uncertain', { status }),
      async () => {
        const result = await sendEmail('key', 'sender@example.com', bill, 1)
        if (result.kind !== 'uncertain') {
          throw new Error(`Expected HTTP ${status} to remain uncertain.`)
        }
      },
    )
  }

  await withFetch(
    async () => {
      throw new TypeError('network unavailable')
    },
    async () => {
      const result = await sendEmail('key', 'sender@example.com', bill, 1)
      if (result.kind !== 'uncertain') {
        throw new Error('Expected a network failure to remain uncertain.')
      }
    },
  )
})

Deno.test('HTML escapes tenant-controlled and bill-controlled content', async () => {
  await withFetch(
    async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        htmlContent: string
        textContent: string
      }
      if (
        body.htmlContent.includes('Guest <One>') ||
        body.htmlContent.includes('Room 3 & Annex') ||
        !body.htmlContent.includes('Guest &lt;One&gt;') ||
        !body.htmlContent.includes('Room 3 &amp; Annex') ||
        body.textContent.includes('Guest &lt;One&gt;')
      ) {
        throw new Error('Expected safe HTML escaping and plain-text values.')
      }
      return Response.json({ messageId: 'template-message' })
    },
    async () => {
      const result = await sendEmail('key', 'sender@example.com', bill, 1)
      if (result.kind !== 'sent') throw new Error('Expected the template send to succeed.')
    },
  )
})

Deno.test('attempt limit is clamped and never becomes negative', async () => {
  let requests = 0
  await withFetch(
    async () => {
      requests += 1
      return Response.json({ messageId: 'unexpected' })
    },
    async () => {
      const result = await sendEmail('key', 'sender@example.com', bill, 10)
      if (result.kind !== 'failed' || result.attempts !== 0 || requests !== 0) {
        throw new Error('Expected exhausted attempt counts to produce zero requests.')
      }
    },
  )
})

Deno.test('missing or empty tenant email takes the no-email path', () => {
  for (const email of [null, undefined, '', '   ']) {
    if (nonEmptyTenantEmail(email) !== null) {
      throw new Error('Expected a missing or empty email to skip delivery.')
    }
  }
  if (nonEmptyTenantEmail(' tenant@example.com ') !== 'tenant@example.com') {
    throw new Error('Expected surrounding whitespace to be removed.')
  }
})
