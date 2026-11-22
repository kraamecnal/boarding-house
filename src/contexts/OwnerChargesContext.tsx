import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { CHARGES, isChargeType, type ChargeType } from '@/data/charges';
import { getSupabaseClient } from '@/utils/supabase';

export type OwnerCharges = Partial<Record<ChargeType, number>>;
export type OwnerChargeInput = Record<ChargeType, number>;

type ContextValue = {
  /** The owner's saved billing charges (water, wifi, trash, electricity rate). */
  charges: OwnerCharges;
  isLoading: boolean;
  loadError: string | null;
  /** True once all four charges exist. Part of the mandatory first-time setup. */
  hasAllCharges: boolean;
  reload: () => void;
  /** Saves all four charges in a single request. */
  saveCharges: (input: OwnerChargeInput) => Promise<void>;
};

const OwnerChargesContext = createContext<ContextValue | undefined>(undefined);

export function OwnerChargesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const ownerId = session?.user.id;
  const [charges, setCharges] = useState<OwnerCharges>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!ownerId) {
      setCharges({});
      setLoadedFor(null);
      setLoadError(null);
      return;
    }

    let isCurrent = true;
    setLoadedFor(null);
    setLoadError(null);

    const load = async () => {
      try {
        const { data, error } = await getSupabaseClient()
          .from('owner_default_charges')
          .select('item_type, unit_price')
          .eq('owner_id', ownerId);
        if (error) throw error;

        const next: OwnerCharges = {};
        for (const row of data ?? []) {
          if (isChargeType(row.item_type)) next[row.item_type] = Number(row.unit_price);
        }
        if (isCurrent) setCharges(next);
      } catch (error: unknown) {
        if (isCurrent) {
          setCharges({});
          setLoadError(
            error instanceof Error ? error.message : 'Could not load your billing charges.',
          );
        }
      } finally {
        if (isCurrent) setLoadedFor(ownerId);
      }
    };

    void load();
    return () => {
      isCurrent = false;
    };
  }, [loadAttempt, ownerId]);

  // Loading until the first load for the signed-in owner finishes, so the app
  // never flashes the wrong screen right after sign-in.
  const isLoading = Boolean(ownerId) && loadedFor !== ownerId;

  const value = useMemo<ContextValue>(
    () => ({
      charges,
      isLoading,
      loadError,
      hasAllCharges: CHARGES.every(({ key }) => typeof charges[key] === 'number'),
      reload: () => setLoadAttempt((attempt) => attempt + 1),
      saveCharges: async (input) => {
        if (!ownerId) throw new Error('Your signed-in owner account could not be identified.');
        const rows = CHARGES.map(({ key }) => ({
          owner_id: ownerId,
          item_type: key,
          unit_price: input[key],
        }));
        const { error } = await getSupabaseClient()
          .from('owner_default_charges')
          .upsert(rows, { onConflict: 'owner_id,item_type' });
        if (error) throw error;
        setCharges({ ...input });
      },
    }),
    [charges, isLoading, loadError, ownerId],
  );

  return <OwnerChargesContext.Provider value={value}>{children}</OwnerChargesContext.Provider>;
}

export function useOwnerCharges() {
  const ctx = useContext(OwnerChargesContext);
  if (!ctx) {
    throw new Error('useOwnerCharges must be used within an OwnerChargesProvider');
  }
  return ctx;
}