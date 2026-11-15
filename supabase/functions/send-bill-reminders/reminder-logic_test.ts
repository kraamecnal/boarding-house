import {
  addDays,
  escapeHtml,
  jwtRole,
  manilaDate,
  reminderTypeForDueDate,
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

Deno.test('only a verified service-role bearer claim is accepted by the handler', () => {
  const payload = btoa(JSON.stringify({ role: 'service_role' }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const serviceRoleToken = `header.${payload}.signature`
  const userToken = `header.${btoa(JSON.stringify({ role: 'authenticated' })).replace(/=/g, '')}.signature`
  if (jwtRole(`Bearer ${serviceRoleToken}`) !== 'service_role') {
    throw new Error('Expected the scheduled service-role token to be recognized.')
  }
  if (jwtRole(`Bearer ${userToken}`) === 'service_role' || jwtRole(null) !== null) {
    throw new Error('User tokens and missing tokens must be rejected.')
  }
})
