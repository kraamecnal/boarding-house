import {
  addDays,
  manilaDate,
  ownerReminderContent,
  reminderTypeForDueDate,
  secretMatches,
} from './reminder-logic.ts'

Deno.test('Manila date conversion handles UTC date boundaries', () => {
  if (manilaDate(new Date('2026-11-09T16:30:00.000Z')) !== '2026-11-10') {
    throw new Error('Expected the UTC time to map to the next date in Manila.')
  }
  if (manilaDate(new Date('2026-11-09T15:59:59.000Z')) !== '2026-11-09') {
    throw new Error('Expected the UTC time before Manila midnight to stay on the prior date.')
  }
})

Deno.test('owner reminders use two days before and due or overdue dates', () => {
  const today = '2026-11-10'
  if (reminderTypeForDueDate(addDays(today, 2), today) !== 'owner_reading_due_soon') {
    throw new Error('Expected a two-days-before owner reminder.')
  }
  if (reminderTypeForDueDate(today, today) !== 'owner_reading_due') {
    throw new Error('Expected an on-due-date owner reminder.')
  }
  if (reminderTypeForDueDate(addDays(today, -3), today) !== 'owner_reading_due') {
    throw new Error('Expected an overdue owner reminder.')
  }
  if (reminderTypeForDueDate(addDays(today, 1), today) !== null) {
    throw new Error('Bills due in one day must not receive a reminder.')
  }
  if (reminderTypeForDueDate(addDays(today, 3), today) !== null) {
    throw new Error('Bills due beyond two days must not receive a reminder.')
  }
})

Deno.test('owner reminders identify the room and house without a bill amount', () => {
  const dueToday = ownerReminderContent('A1', 'Bg1', '2026-11-10', '2026-11-10')
  const dueSoon = ownerReminderContent('A1', 'Bg1', '2026-11-12', '2026-11-10')
  const overdue = ownerReminderContent('A1', 'Bg1', '2026-11-08', '2026-11-10')

  for (const reminder of [dueToday, dueSoon, overdue]) {
    if (!reminder || /\bPHP\b|\u20b1/.test(`${reminder.title} ${reminder.message}`)) {
      throw new Error('Owner reminders must not include a bill amount.')
    }
  }
  if (dueSoon?.message !== 'The bill for A1 at Bg1 is due in 2 days. Enter the meter reading.') {
    throw new Error('Due-soon reminders must include the room and boarding house.')
  }
  if (dueToday?.message !== 'The bill for A1 at Bg1 is due today. Enter the meter reading.') {
    throw new Error('Due-today reminders must include the room and boarding house.')
  }
  if (
    overdue?.message !==
    'The bill for A1 at Bg1 was due on 2026-11-08. Enter the meter reading.'
  ) {
    throw new Error('Overdue reminders must include the room and boarding house.')
  }
  if (!overdue?.message.includes('Enter the meter reading')) {
    throw new Error('Overdue owner reminders must prompt for a meter reading.')
  }
})

Deno.test('owner reminders fall back safely without a boarding house name', () => {
  const reminder = ownerReminderContent('A1', null, '2026-11-10', '2026-11-10')
  if (reminder?.message !== 'The bill for A1 is due today. Enter the meter reading.') {
    throw new Error('Missing house names must preserve a valid room-only reminder.')
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
