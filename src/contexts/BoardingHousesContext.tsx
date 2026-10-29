import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import type { BoardingHouse } from '@/data/boardingHouses';
import { getSupabaseClient } from '@/utils/supabase';

export type { BoardingHouse };

type NewHouseInput = Pick<BoardingHouse, 'name' | 'address'>;
type BoardingHouseRow = {
  boarding_house_id: string;
  name: string | null;
  address: string | null;
  last_updated_at: string;
};

type ContextValue = {
  boardingHouses: BoardingHouse[];
  isLoading: boolean;
  loadError: string | null;
  reload: () => void;
  getHouseById: (id: string) => BoardingHouse | undefined;
  isNameTaken: (name: string) => boolean;
  addHouse: (input: NewHouseInput) => Promise<void>;
};

const BoardingHousesContext = createContext<ContextValue | undefined>(undefined);

function mapHouse(row: BoardingHouseRow): BoardingHouse {
  return {
    id: row.boarding_house_id,
    name: row.name ?? '',
    address: row.address ?? '',
    createdAt: row.last_updated_at,
  };
}

export function BoardingHousesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const ownerId = session?.user.id;
  const [boardingHouses, setBoardingHouses] = useState<BoardingHouse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;

    const loadHouses = async () => {
      setIsLoading(true);
      setLoadError(null);
      if (!ownerId) {
        setBoardingHouses([]);
        setIsLoading(false);
        return;
      }

      try {
        const { data, error } = await getSupabaseClient()
          .from('boarding_house')
          .select('boarding_house_id, name, address, last_updated_at')
          .eq('owner_id', ownerId)
          .order('last_updated_at', { ascending: false });
        if (error) throw error;
        if (isCurrent) setBoardingHouses((data ?? []).map(mapHouse));
      } catch (error: unknown) {
        if (isCurrent) {
          setBoardingHouses([]);
          setLoadError(error instanceof Error ? error.message : 'Could not load boarding houses.');
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    void loadHouses();
    return () => {
      isCurrent = false;
    };
  }, [loadAttempt, ownerId]);

  const value = useMemo<ContextValue>(
    () => ({
      boardingHouses,
      isLoading,
      loadError,
      reload: () => setLoadAttempt((attempt) => attempt + 1),
      getHouseById: (id) => boardingHouses.find((house) => house.id === id),
      isNameTaken: (name) =>
        boardingHouses.some(
          (house) => house.name.trim().toLowerCase() === name.trim().toLowerCase(),
        ),
      addHouse: async (input) => {
        if (!ownerId) throw new Error('Your signed-in owner account could not be identified.');
        const { data, error } = await getSupabaseClient()
          .from('boarding_house')
          .insert({ owner_id: ownerId, name: input.name.trim(), address: input.address.trim() })
          .select('boarding_house_id, name, address, last_updated_at')
          .single();
        if (error) throw error;
        setBoardingHouses((current) => [mapHouse(data), ...current]);
      },
    }),
    [boardingHouses, isLoading, loadError, ownerId],
  );

  return <BoardingHousesContext.Provider value={value}>{children}</BoardingHousesContext.Provider>;
}

export function useBoardingHouses() {
  const ctx = useContext(BoardingHousesContext);
  if (!ctx) {
    throw new Error('useBoardingHouses must be used within a BoardingHousesProvider');
  }
  return ctx;
}
