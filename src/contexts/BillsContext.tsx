// src/contexts/BillsContext.tsx  (REWRITTEN)
//
// Remembers, for every tenant and month, what was typed into the Electricity
// field and whether the bill is marked paid. Amounts (rent, fixed costs,
// total) are NOT stored here: they are calculated on every render with
// computeTotals() from utils/billing.ts, which is what keeps the total live.
//
// In-memory only, so it resets when the app restarts (same as RoomsContext).

import { createContext, ReactNode, useContext, useMemo, useReducer } from 'react';

import { DUE_DAY_OF_NEXT_MONTH } from '@/data/billingConfig';
import { dueDateFor, sanitizeAmountInput, todayIso } from '@/utils/billing';

export type BillStatus = 'unpaid' | 'paid';

/** Everything the bill screen needs that isn't calculated from the tenant's rent. */
export type BillRecord = {
  period: string; // "2026-09"
  issuedDate: string; // "2026-09-22"
  dueDate: string; // "2026-10-05"
  electricity: string; // the raw text in the field, '' when nothing is typed yet
  status: BillStatus;
  paidDate: string | null;
};

type BillEntry = Omit<BillRecord, 'period' | 'dueDate'>;
type BillEntries = Record<string, BillEntry>;

const entryKey = (roomId: string, period: string) => `${roomId}|${period}`;

type BillsAction =
  | { type: 'SET_ELECTRICITY'; payload: { roomId: string; period: string; text: string } }
  | { type: 'SET_STATUS'; payload: { roomId: string; period: string; status: BillStatus } };

function upsert(
  state: BillEntries,
  roomId: string,
  period: string,
  changes: Partial<BillEntry>
): BillEntries {
  const key = entryKey(roomId, period);
  const previous: BillEntry = state[key] ?? {
    issuedDate: todayIso(),
    electricity: '',
    status: 'unpaid',
    paidDate: null,
  };
  return { ...state, [key]: { ...previous, ...changes } };
}

function billsReducer(state: BillEntries, action: BillsAction): BillEntries {
  switch (action.type) {
    case 'SET_ELECTRICITY': {
      const { roomId, period, text } = action.payload;
      return upsert(state, roomId, period, { electricity: text });
    }
    case 'SET_STATUS': {
      const { roomId, period, status } = action.payload;
      return upsert(state, roomId, period, {
        status,
        paidDate: status === 'paid' ? todayIso() : null,
      });
    }
    default:
      return state;
  }
}

type BillsContextValue = {
  /** Changes whenever any bill changes. Pass it to FlatList's `extraData`. */
  records: BillEntries;
  /** Always returns a record; a month nobody has touched yet gets sensible defaults. */
  getBill: (roomId: string, period: string) => BillRecord;
  setElectricity: (roomId: string, period: string, text: string) => void;
  setStatus: (roomId: string, period: string, status: BillStatus) => void;
};

const BillsContext = createContext<BillsContextValue | undefined>(undefined);

export function BillsProvider({ children }: { children: ReactNode }) {
  const [records, dispatch] = useReducer(billsReducer, {} as BillEntries);

  const value = useMemo<BillsContextValue>(
    () => ({
      records,
      getBill: (roomId, period) => {
        const entry = records[entryKey(roomId, period)];
        return {
          period,
          // Until something is typed or ticked, the issue date is simply "today".
          issuedDate: entry?.issuedDate ?? todayIso(),
          dueDate: dueDateFor(period, DUE_DAY_OF_NEXT_MONTH),
          electricity: entry?.electricity ?? '',
          status: entry?.status ?? 'unpaid',
          paidDate: entry?.paidDate ?? null,
        };
      },
      setElectricity: (roomId, period, text) =>
        dispatch({
          type: 'SET_ELECTRICITY',
          payload: { roomId, period, text: sanitizeAmountInput(text) },
        }),
      setStatus: (roomId, period, status) =>
        dispatch({ type: 'SET_STATUS', payload: { roomId, period, status } }),
    }),
    [records]
  );

  return <BillsContext.Provider value={value}>{children}</BillsContext.Provider>;
}

export function useBills() {
  const ctx = useContext(BillsContext);
  if (!ctx) {
    throw new Error('useBills must be used within a BillsProvider');
  }
  return ctx;
}