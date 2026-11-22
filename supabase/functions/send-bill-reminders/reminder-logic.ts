export type ReminderType =
  | 'owner_reading_due_soon'
  | 'owner_reading_due'

export type OwnerReminderContent = {
  type: ReminderType
  title: string
  message: string
}

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
  if (dueDate === addDays(today, 2)) return 'owner_reading_due_soon'
  if (dueDate <= today) return 'owner_reading_due'
  return null
}

export function ownerReminderContent(
  roomName: string,
  boardingHouseName: string | null,
  dueDate: string,
  today: string,
): OwnerReminderContent | null {
  const type = reminderTypeForDueDate(dueDate, today)
  if (!type) return null

  const roomLabel = boardingHouseName
    ? `${roomName || 'this room'} at ${boardingHouseName}`
    : roomName || 'this room'

  if (type === 'owner_reading_due_soon') {
    return {
      type,
      title: 'Meter reading due soon',
      message: `The bill for ${roomLabel} is due in 2 days. Enter the meter reading.`,
    }
  }

  return {
    type,
    title: dueDate === today ? 'Meter reading due today' : 'Meter reading overdue',
    message:
      dueDate === today
        ? `The bill for ${roomLabel} is due today. Enter the meter reading.`
        : `The bill for ${roomLabel} was due on ${dueDate}. Enter the meter reading.`,
  }
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
