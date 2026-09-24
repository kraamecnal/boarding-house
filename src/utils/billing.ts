// src/utils/billing.ts  (REPLACES the previous version)
//
// Pure helpers (no React). Dates are "YYYY-MM-DD" strings and billing
// periods are "YYYY-MM" strings, the same style RoomsContext uses.

import type { BillStatus } from '@/contexts/BillsContext';
import type { Room } from '@/contexts/RoomsContext';
import { FIXED_COSTS_AMOUNT, FIXED_COSTS_LABEL, PAYMENT_REMINDER } from '@/data/billingConfig';

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
// "Sept" matches the wording in your example bill.
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
];

const pad = (n: number) => String(n).padStart(2, '0');

/* ---------- dates & periods ---------- */

/** Today as "YYYY-MM-DD" in the device's local time. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The current billing period, e.g. "2026-09". */
export function currentPeriod(): string {
  return todayIso().slice(0, 7);
}

/** Moves a "YYYY-MM" period forward (+) or backward (-) by whole months. */
export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "2026-09" -> "September 2026" */
export function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/** "2026-09-22" -> "Sept 22, 2026" */
export function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${MONTHS_SHORT[month - 1]} ${day}, ${year}`;
}

/**
 * Due date for a billing period: `dueDay` of the FOLLOWING month.
 * Clamps to the month's last day (e.g. dueDay 31 in a 30-day month).
 */
export function dueDateFor(period: string, dueDay: number): string {
  const next = shiftPeriod(period, 1);
  const [year, month] = next.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  return `${next}-${pad(Math.min(dueDay, daysInMonth))}`;
}

/* ---------- money ---------- */

/** 4650 -> "₱4,650.00" */
export function formatPeso(amount: number): string {
  const [whole, decimals] = amount.toFixed(2).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₱${withCommas}.${decimals}`;
}

/**
 * Cleans what the user types into the electricity field:
 * digits and a single decimal point, at most 2 decimal places.
 */
export function sanitizeAmountInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  if (rest.length === 0) return whole;
  return `${whole}.${rest.join('').slice(0, 2)}`;
}

/** Turns the typed text into a number. Empty or invalid input counts as 0. */
export function parseAmount(input: string): number {
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export type BillTotals = {
  roomRent: number;
  fixedCosts: number;
  partial: number; // room rent + fixed costs
  electricity: number;
  total: number; // partial + electricity
};

/**
 * Works out every amount on the statement from the tenant's rent and the
 * electricity text currently typed in. Call it on every render and the
 * total updates in real time as the user types.
 */
export function computeTotals(roomRent: number, electricityInput: string): BillTotals {
  const electricity = parseAmount(electricityInput);
  const partial = roomRent + FIXED_COSTS_AMOUNT;
  return {
    roomRent,
    fixedCosts: FIXED_COSTS_AMOUNT,
    partial,
    electricity,
    total: Math.round((partial + electricity) * 100) / 100,
  };
}

/* ---------- plain-text version (for the Share button) ---------- */

const WIDTH = 39;

const row = (label: string, value: string) =>
  label + ' '.repeat(Math.max(1, WIDTH - label.length - value.length)) + value;

const field = (label: string, value: string) => `${label.padEnd(21)}${value}`;

const center = (text: string) =>
  ' '.repeat(Math.max(0, Math.floor((WIDTH - text.length) / 2))) + text;

type BillTextInput = {
  room: Room;
  period: string;
  issuedDate: string;
  dueDate: string;
  electricity: string;
  status: BillStatus;
};

/** Builds the statement in the same layout as your example bill. */
export function buildBillText({
  room,
  period,
  issuedDate,
  dueDate,
  electricity,
  status,
}: BillTextInput): string {
  const totals = computeTotals(room.monthlyRent, electricity);
  const heavy = '═'.repeat(WIDTH);
  const light = '-'.repeat(WIDTH);

  return [
    heavy,
    center('MONTHLY BILLING STATEMENT'),
    heavy,
    '',
    field('Room No.:', room.roomName),
    field('Tenant Name:', `${room.firstName} ${room.lastName}`),
    field('Contact:', room.contactNumber),
    field('Email:', room.email),
    '',
    light,
    field('Billing Period:', periodLabel(period)),
    field('Bill Date Issued:', formatShortDate(issuedDate)),
    field('Due Date:', formatShortDate(dueDate)),
    light,
    '',
    'ITEMIZED BREAKDOWN',
    light,
    row('Room Rent', formatPeso(totals.roomRent)),
    'Fixed Costs',
    row(`  (${FIXED_COSTS_LABEL})`, formatPeso(totals.fixedCosts)),
    row('', '-----------'),
    row('Partial Monthly Bill', formatPeso(totals.partial)),
    '',
    row('Electricity', formatPeso(totals.electricity)),
    row('', '-----------'),
    row('TOTAL AMOUNT DUE', formatPeso(totals.total)),
    light,
    '',
    `Payment Status:      ${status === 'paid' ? '☐ UNPAID    ☒ PAID' : '☒ UNPAID    ☐ PAID'}`,
    '',
    heavy,
    PAYMENT_REMINDER,
    heavy,
  ].join('\n');
}