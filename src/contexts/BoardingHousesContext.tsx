import { createContext, ReactNode, useContext, useMemo, useReducer } from 'react';

import type { BoardingHouse } from '@/data/boardingHouses';

export type { BoardingHouse };

type NewHouseInput = Pick<BoardingHouse, 'name' | 'address'>;

/** Pre-fill houses here if you want some to exist on every app start. */
const SEED_HOUSES: BoardingHouse[] = [
  // { id: '1', name: 'BH1', address: 'Your address here', createdAt: new Date().toISOString() },
];

type Action = { type: 'ADD_HOUSE'; payload: BoardingHouse };

function reducer(state: BoardingHouse[], action: Action): BoardingHouse[] {
  switch (action.type) {
    case 'ADD_HOUSE':
      return [...state, action.payload];
    default:
      return state;
  }
}

type ContextValue = {
  boardingHouses: BoardingHouse[];
  getHouseById: (id: string) => BoardingHouse | undefined;
  isNameTaken: (name: string) => boolean;
  addHouse: (input: NewHouseInput) => BoardingHouse;
};

const BoardingHousesContext = createContext<ContextValue | undefined>(undefined);

export function BoardingHousesProvider({ children }: { children: ReactNode }) {
  const [boardingHouses, dispatch] = useReducer(reducer, SEED_HOUSES);

  const value = useMemo<ContextValue>(
    () => ({
      boardingHouses,
      getHouseById: (id) => boardingHouses.find((h) => h.id === id),
      isNameTaken: (name) =>
        boardingHouses.some((h) => h.name.trim().toLowerCase() === name.trim().toLowerCase()),
      addHouse: (input) => {
        const house: BoardingHouse = {
          name: input.name.trim(),
          address: input.address.trim(),
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'ADD_HOUSE', payload: house });
        return house;
      },
    }),
    [boardingHouses]
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