export type ReminderType = 'two_days_before' | 'on_due_date'

export function manilaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function reminderTypeForDueDate(
  dueDate: string,
  today: string,
): ReminderType | null {
  if (dueDate === today) return 'on_due_date'
  if (dueDate === addDays(today, 2)) return 'two_days_before'
  return null
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
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

export function secretMatches(provided: string | null, expected: string | null): boolean {
  if (provided === null || expected === null || expected.length === 0) return false

  const encoder = new TextEncoder()
  const providedBytes = encoder.encode(provided)
  const expectedBytes = encoder.encode(expected)
  const maxLength = Math.max(providedBytes.length, expectedBytes.length)
  let difference = providedBytes.length ^ expectedBytes.length

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (providedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }

  return difference === 0
}
