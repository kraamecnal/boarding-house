import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { isOccupied, useRooms, type Room } from '@/contexts/RoomsContext';
import { DUE_DAY_OF_NEXT_MONTH } from '@/data/billingConfig';
import { computeTotals, dueDateFor } from '@/utils/billing';
import { getSupabaseClient } from '@/utils/supabase';

export type BillStatus = 'unpaid' | 'paid';

export type PaidSnapshot = {
  roomRent: number;
  electricity: number;
  total: number;
};

export type PaidBill = {
  period: string;
  paidDate: string;
  snapshot: PaidSnapshot;
};

export type BillItem = {
  id: string;
  itemType: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type BillRecord = {
  billId: string | null;
  period: string;
  issuedDate: string;
  dueDate: string;
  electricity: string;
  status: BillStatus;
  paidDate: string | null;
  paidSnapshot: PaidSnapshot | null;
  items: BillItem[];
  totalAmount: number;
  isFinalized: boolean;
};

type BillEntries = Record<string, BillRecord>;

type DbBillItem = {
  bill_item_id: string;
  item_type: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  amount: number | null;
};

type DbBill = {
  bill_id: string;
  tenancy_id: string;
  period_start: string;
  due_date: string;
  billed_at: string | null;
  created_at: string;
  total_amount: number;
  paid_at: string | null;
  is_paid: boolean | null;
  bill_items: DbBillItem[] | null;
};

const entryKey = (roomId: string, period: string) => `${roomId}|${period}`;

function mapBill(row: DbBill): BillRecord {
  const items = (row.bill_items ?? []).map((item) => ({
    id: item.bill_item_id,
    itemType: item.item_type,
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unit_price),
    amount: Number(item.amount ?? Number(item.quantity) * Number(item.unit_price)),
  }));
  const paid = row.is_paid === true || row.paid_at !== null;
  const electricity =
    items.find((item) => item.itemType === 'adjustment' && item.description === 'Electricity')
      ?.amount.toFixed(2) ?? '';
  const totalAmount = Number(row.total_amount);
  const snapshot: PaidSnapshot = {
    roomRent: items
      .filter((item) => item.itemType === 'rent')
      .reduce((sum, item) => sum + item.amount, 0),
    electricity: items
      .filter(
        (item) =>
          item.itemType === 'electricity' ||
          (item.itemType === 'adjustment' && item.description === 'Electricity'),
      )
      .reduce((sum, item) => sum + item.amount, 0),
    total: totalAmount,
  };

  return {
    billId: row.bill_id,
    period: row.period_start.slice(0, 7),
    issuedDate: row.billed_at ?? 'Not yet issued',
    dueDate: row.due_date,
    electricity,
    status: paid ? 'paid' : 'unpaid',
    paidDate: row.paid_at?.slice(0, 10) ?? null,
    paidSnapshot: paid ? snapshot : null,
    items,
    totalAmount,
    isFinalized: row.billed_at !== null,
  };
}

function makeDefaultBill(room: Room | undefined, period: string): BillRecord {
  const totalAmount = room ? computeTotals(room.monthlyRate, '').partial : 0;
  return {
    billId: null,
    period,
    issuedDate: 'Not yet issued',
    dueDate: dueDateFor(period, DUE_DAY_OF_NEXT_MONTH),
    electricity: '',
    status: 'unpaid',
    paidDate: null,
    paidSnapshot: null,
    items: [],
    totalAmount,
    isFinalized: false,
  };
}

type BillsContextValue = {
  records: BillEntries;
  isLoading: boolean;
  loadError: string | null;
  reload: () => void;
  getBill: (roomId: string, period: string) => BillRecord;
  getLatestBillDueDate: (roomId: string) => string | null;
  setStatus: (
    roomId: string,
    period: string,
    status: BillStatus,
    snapshot?: PaidSnapshot,
  ) => Promise<void>;
  getPaidBills: (roomId: string) => PaidBill[];
};

const BillsContext = createContext<BillsContextValue | undefined>(undefined);

function recordKey(roomId: string, period: string) {
  return entryKey(roomId, period);
}

export function BillsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { rooms, isLoading: isLoadingRooms } = useRooms();
  const ownerId = session?.user.id;
  const tenancyIds = rooms
    .filter(isOccupied)
    .map((room) => room.tenant.tenancyId)
    .filter(Boolean);
  const tenancyKey = tenancyIds.slice().sort().join(',');
  const [records, setRecords] = useState<BillEntries>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const reload = useCallback(() => setLoadAttempt((attempt) => attempt + 1), []);

  useEffect(() => {
    let isCurrent = true;

    const loadBills = async () => {
      if (isLoadingRooms) return;
      setIsLoading(true);
      setLoadError(null);
      if (!ownerId || tenancyIds.length === 0) {
        setRecords({});
        setIsLoading(false);
        return;
      }

      try {
        const { data, error } = await getSupabaseClient()
          .from('monthly_bill')
          .select(
            'bill_id, tenancy_id, period_start, due_date, billed_at, created_at, total_amount, paid_at, is_paid, bill_items(bill_item_id,item_type,description,quantity,unit_price,amount)',
          )
          .in('tenancy_id', tenancyIds)
          .order('period_start', { ascending: false });
        if (error) throw error;

        const roomsByTenancy = new Map(
          rooms.filter(isOccupied).map((room) => [room.tenant.tenancyId, room]),
        );
        const nextRecords: BillEntries = {};
        for (const row of (data ?? []) as DbBill[]) {
          const room = roomsByTenancy.get(row.tenancy_id);
          if (room) {
            const bill = mapBill(row);
            nextRecords[recordKey(room.id, bill.period)] = bill;
          }
        }
        if (isCurrent) setRecords(nextRecords);
      } catch (error: unknown) {
        if (isCurrent) {
          setRecords({});
          setLoadError(error instanceof Error ? error.message : 'Could not load monthly bills.');
        }
      } finally {
        if (isCurrent && !isLoadingRooms) setIsLoading(false);
      }
    };

    void loadBills();
    return () => {
      isCurrent = false;
    };
  }, [isLoadingRooms, loadAttempt, ownerId, tenancyKey, rooms]);

  const value = useMemo<BillsContextValue>(
    () => ({
      records,
      isLoading,
      loadError,
      reload,
      getBill: (roomId, period) =>
        records[recordKey(roomId, period)] ??
        makeDefaultBill(rooms.find((room) => room.id === roomId), period),
      getLatestBillDueDate: (roomId) =>
        Object.entries(records)
          .filter(([key, record]) => key.startsWith(`${roomId}|`) && record.billId !== null)
          .map(([, record]) => record)
          .sort((a, b) => b.period.localeCompare(a.period))[0]?.dueDate ?? null,
      setStatus: async (roomId, period, status) => {
        const record = records[recordKey(roomId, period)];
        if (!record?.billId) throw new Error('This monthly bill has not been generated yet.');
        const { error } = await getSupabaseClient()
          .from('monthly_bill')
          .update({
            paid_at: status === 'paid' ? new Date().toISOString() : null,
          })
          .eq('bill_id', record.billId)
          .select('bill_id')
          .single();
        if (error) throw error;
        setLoadAttempt((attempt) => attempt + 1);
      },
      getPaidBills: (roomId) =>
        Object.entries(records)
          .filter(([key, record]) => key.startsWith(`${roomId}|`) && record.status === 'paid')
          .map(([, record]) => ({
            period: record.period,
            paidDate: record.paidDate ?? record.issuedDate,
            snapshot:
              record.paidSnapshot ?? {
                roomRent: 0,
                electricity: 0,
                total: record.totalAmount,
              },
          }))
          .sort((a, b) => b.period.localeCompare(a.period)),
    }),
    [isLoading, loadError, records, reload, rooms],
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
