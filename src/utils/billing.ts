import type { BillStatus } from '@/contexts/BillsContext';
import type { Room } from '@/contexts/RoomsContext';
import { FIXED_COSTS_AMOUNT, FIXED_COSTS_LABEL, PAYMENT_REMINDER } from '@/data/billingConfig';

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function currentPeriod(): string {
  return todayIso().slice(0, 7);
}

export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

export function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${MONTHS_SHORT[month - 1]} ${day}, ${year}`;
}

export function dueDateFor(period: string, dueDay: number): string {
  const next = shiftPeriod(period, 1);
  const [year, month] = next.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  return `${next}-${pad(Math.min(dueDay, daysInMonth))}`;
}


export function formatPeso(amount: number): string {
  const [whole, decimals] = amount.toFixed(2).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₱${withCommas}.${decimals}`;
}

export function sanitizeAmountInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  if (rest.length === 0) return whole;
  return `${whole}.${rest.join('').slice(0, 2)}`;
}

export function parseAmount(input: string): number {
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export type BillTotals = {
  roomRent: number;
  fixedCosts: number;
  partial: number; 
  electricity: number;
  total: number; 
};

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
