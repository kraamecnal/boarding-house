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

export function jwtRole(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i)
  if (!match) return null

  try {
    const payload = match[1].split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const claims: unknown = JSON.parse(decoded)
    if (typeof claims !== 'object' || claims === null || !('role' in claims)) return null
    return typeof claims.role === 'string' ? claims.role : null
  } catch {
    return null
  }
}
