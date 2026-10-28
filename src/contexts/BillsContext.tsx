import { createContext, ReactNode, useContext, useMemo, useReducer } from 'react';

import { DUE_DAY_OF_NEXT_MONTH } from '@/data/billingConfig';
import { dueDateFor, sanitizeAmountInput, todayIso } from '@/utils/billing';

export type BillStatus = 'unpaid' | 'paid';

/** Amounts frozen at the moment a bill is marked paid. */
export type PaidSnapshot = {
  roomRent: number;
  electricity: number;
  total: number;
};

export type PaidBill = {
  period: string; // 'YYYY-MM'
  paidDate: string; // 'YYYY-MM-DD'
  snapshot: PaidSnapshot;
};


export type BillRecord = {
  period: string; 
  issuedDate: string; 
  dueDate: string; 
  electricity: string; 
  status: BillStatus;
  paidDate: string | null;
  paidSnapshot: PaidSnapshot | null;
};

type BillEntry = Omit<BillRecord, 'period' | 'dueDate'>;
type BillEntries = Record<string, BillEntry>;

const entryKey = (roomId: string, period: string) => `${roomId}|${period}`;

type BillsAction =
  | { type: 'SET_ELECTRICITY'; payload: { roomId: string; period: string; text: string } }
  | {
      type: 'SET_STATUS';
      payload: {
        roomId: string;
        period: string;
        status: BillStatus;
        snapshot: PaidSnapshot | null;
      };
    };

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
    paidSnapshot: null,
  };
  return { ...state, [key]: { ...previous, ...changes } };
}

function billsReducer(state: BillEntries, action: BillsAction): BillEntries {
  switch (action.type) {
    case 'SET_ELECTRICITY': {
      const { roomId, period, text } = action.payload;
      // A paid bill is locked; switch it back to unpaid to edit.
      if (state[entryKey(roomId, period)]?.status === 'paid') return state;
      return upsert(state, roomId, period, { electricity: text });
    }
    case 'SET_STATUS': {
      const { roomId, period, status, snapshot } = action.payload;
      if (status === 'paid' && !snapshot) return state;
      return upsert(state, roomId, period, {
        status,
        paidDate: status === 'paid' ? todayIso() : null,
        paidSnapshot: status === 'paid' ? snapshot : null,
      });
    }
    default:
      return state;
  }
}

type BillsContextValue = {
  records: BillEntries;
  getBill: (roomId: string, period: string) => BillRecord;
  setElectricity: (roomId: string, period: string, text: string) => void;
  setStatus: (roomId: string, period: string, status: BillStatus, snapshot?: PaidSnapshot) => void;
  getPaidBills: (roomId: string) => PaidBill[];
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
          issuedDate: entry?.issuedDate ?? todayIso(),
          dueDate: dueDateFor(period, DUE_DAY_OF_NEXT_MONTH),
          electricity: entry?.electricity ?? '',
          status: entry?.status ?? 'unpaid',
          paidDate: entry?.paidDate ?? null,
          paidSnapshot: entry?.paidSnapshot ?? null,
        };
      },
      setElectricity: (roomId, period, text) =>
        dispatch({
          type: 'SET_ELECTRICITY',
          payload: { roomId, period, text: sanitizeAmountInput(text) },
        }),
      setStatus: (roomId, period, status, snapshot) =>
        dispatch({
          type: 'SET_STATUS',
          payload: { roomId, period, status, snapshot: snapshot ?? null },
        }),
      getPaidBills: (roomId) =>
        Object.entries(records)
          .filter(
            ([key, entry]) =>
              key.startsWith(`${roomId}|`) && entry.status === 'paid' && entry.paidSnapshot !== null
          )
          .map(([key, entry]) => ({
            period: key.slice(roomId.length + 1),
            paidDate: entry.paidDate ?? entry.issuedDate,
            snapshot: entry.paidSnapshot as PaidSnapshot,
          }))
          .sort((a, b) => b.period.localeCompare(a.period)),
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