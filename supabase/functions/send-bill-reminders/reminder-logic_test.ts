import {
  addDays,
  escapeHtml,
  manilaDate,
  reminderTypeForDueDate,
  secretMatches,
} from './reminder-logic.ts'

Deno.test('Manila date conversion handles UTC date boundaries', () => {
  if (manilaDate(new Date('2026-11-09T16:30:00.000Z')) !== '2026-11-10') {
    throw new Error('Expected the UTC time to map to the next date in Manila.')
  }
})

Deno.test('reminder types are limited to due date and two days before', () => {
  const today = '2026-11-10'
  if (reminderTypeForDueDate(today, today) !== 'on_due_date') {
    throw new Error('Expected an on-due-date reminder.')
  }
  if (reminderTypeForDueDate(addDays(today, 2), today) !== 'two_days_before') {
    throw new Error('Expected a two-days-before reminder.')
  }
  if (reminderTypeForDueDate(addDays(today, 1), today) !== null) {
    throw new Error('Bills due on another date must not be eligible.')
  }
})

Deno.test('HTML content escapes tenant-controlled values', () => {
  if (escapeHtml(`<Tenant & "Guest">`) !== '&lt;Tenant &amp; &quot;Guest&quot;&gt;') {
    throw new Error('Expected HTML-special characters to be escaped.')
  }
})

Deno.test('cron authentication requires the exact configured secret', () => {
  const expected = 'a'.repeat(64)
  if (!secretMatches(expected, expected)) {
    throw new Error('Expected the configured cron secret to be accepted.')
  }
  if (
    secretMatches(`${expected}b`, expected) ||
    secretMatches(null, expected) ||
    secretMatches(expected, null) ||
    secretMatches('', '')
  ) {
    throw new Error('A missing or mismatched cron secret must be rejected.')
  }
})
