import type { BillStatus } from '@/contexts/BillsContext';
import type { BillItem } from '@/contexts/BillsContext';
import type { OccupiedRoom } from '@/contexts/RoomsContext';
import { formatRoomLabel } from '@/components/RoomLabel';
import { FIXED_COSTS_AMOUNT, FIXED_COSTS_LABEL, PAYMENT_REMINDER } from '@/data/billingConfig';
import { todayInManila } from '@/utils/manilaDate';

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function todayIso(): string {
  return todayInManila();
}

export function currentPeriod(): string {
  return todayIso().slice(0, 7);
}

export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Whole days from `fromIso` to `toIso` (both 'YYYY-MM-DD'). Negative if toIso is earlier. */
export function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/** Every 'YYYY-MM' period from start through end, inclusive. */
export function listPeriods(startPeriod: string, endPeriod: string): string[] {
  const periods: string[] = [];
  let p = startPeriod;
  while (p <= endPeriod) {
    periods.push(p);
    p = shiftPeriod(p, 1);
  }
  return periods;
}

export function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

export function formatShortDate(iso: string): string {
  if (!iso || iso === 'Not yet issued') return 'Not yet issued';

  const timestamp = new Date(iso);
  if (Number.isNaN(timestamp.getTime())) {
    return iso;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return formatter.format(timestamp);
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
  room: OccupiedRoom;
  boardingHouseName?: string;
  period: string;
  issuedDate: string;
  dueDate: string;
  electricity: string;
  status: BillStatus;
  items?: BillItem[];
  totalAmount?: number;
};

export function buildBillText({
  room,
  boardingHouseName,
  period,
  issuedDate,
  dueDate,
  electricity,
  status,
  items,
  totalAmount,
}: BillTextInput): string {
  const totals = computeTotals(room.monthlyRate, electricity);
  const itemRows = items?.length
    ? items.map((item) =>
        row(
          item.description ?? billItemLabel(item.itemType),
          formatPeso(item.amount),
        ),
      )
    : [
        row('Room Rent', formatPeso(totals.roomRent)),
        'Fixed Costs',
        row(`  (${FIXED_COSTS_LABEL})`, formatPeso(totals.fixedCosts)),
      ];
  const total = totalAmount ?? totals.total;
  const heavy = '═'.repeat(WIDTH);
  const light = '-'.repeat(WIDTH);

  const issuedValue = issuedDate && issuedDate !== 'Not yet issued' ? formatShortDate(issuedDate) : 'Not yet issued';

  return [
    heavy,
    center('MONTHLY BILLING STATEMENT'),
    heavy,
    '',
    field('Room:', formatRoomLabel(room.roomName)),
    field('Tenant Name:', `${room.tenant.firstName} ${room.tenant.lastName}`),
    field('Contact:', room.tenant.contactNumber),
    field('Email:', room.tenant.email),
    '',
    light,
    field('Billing Period:', periodLabel(period)),
    field('Bill Date Issued:', issuedValue),
    field('Due Date:', formatShortDate(dueDate)),
    light,
    '',
    'ITEMIZED BREAKDOWN',
    light,
    ...itemRows,
    ...(items?.length ? [] : ['', row('Electricity', formatPeso(totals.electricity))]),
    row('', '-----------'),
    row('TOTAL AMOUNT DUE', formatPeso(total)),
    light,
    '',
    `Payment Status:      ${status === 'paid' ? '☐ UNPAID    ☒ PAID' : '☒ UNPAID    ☐ PAID'}`,
    '',
    heavy,
    PAYMENT_REMINDER,
    heavy,
  ].join('\n');
}

function billItemLabel(itemType: string): string {
  switch (itemType) {
    case 'rent':
      return 'Room rent';
    case 'water':
      return 'Water';
    case 'trash':
      return 'Trash';
    case 'wifi':
      return 'Wi-Fi';
    case 'electricity':
      return 'Electricity';
    default:
      return 'Adjustment';
  }
}