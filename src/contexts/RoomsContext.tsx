import { createContext, ReactNode, useContext, useMemo, useReducer } from 'react';

export type Room = {
  id: string;
  boardingHouseId: string;
  firstName: string;
  lastName: string;
  email: string;
  contactNumber: string;
  startDate: string; // e.g. "2026-09-17"
  dueDate: string; // e.g. "2026-10-17"
  monthlyRent: number;
  createdAt: string;
};

type NewRoomInput = Omit<Room, 'id' | 'createdAt'>;

type RoomsAction =
  | { type: 'ADD_ROOM'; payload: Room }
  | { type: 'REMOVE_ROOM'; payload: { id: string } }
  | { type: 'SET_ROOMS'; payload: Room[] };

function roomsReducer(state: Room[], action: RoomsAction): Room[] {
  switch (action.type) {
    case 'ADD_ROOM':
      return [...state, action.payload];
    case 'REMOVE_ROOM':
      return state.filter((room) => room.id !== action.payload.id);
    case 'SET_ROOMS':
      return action.payload;
    default:
      return state;
  }
}

type RoomsContextValue = {
  rooms: Room[];
  getRoomsForHouse: (boardingHouseId: string) => Room[];
  addRoom: (input: NewRoomInput) => void;
  removeRoom: (id: string) => void;
};

const RoomsContext = createContext<RoomsContextValue | undefined>(undefined);

/**
 * Frontend-only in-memory store for registered tenants/rooms.
 *
 * This resets whenever the app restarts. When you're ready to wire this
 * up to a real backend, this is the ONLY file you need to change: swap
 * the `dispatch` calls below for API requests (see the notes at the end
 * of the chat response for a walkthrough).
 */
export function RoomsProvider({ children }: { children: ReactNode }) {
  const [rooms, dispatch] = useReducer(roomsReducer, []);

  const value = useMemo<RoomsContextValue>(
    () => ({
      rooms,
      getRoomsForHouse: (boardingHouseId) =>
        rooms.filter((room) => room.boardingHouseId === boardingHouseId),
      addRoom: (input) => {
        const room: Room = {
          ...input,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'ADD_ROOM', payload: room });
      },
      removeRoom: (id) => dispatch({ type: 'REMOVE_ROOM', payload: { id } }),
    }),
    [rooms]
  );

  return <RoomsContext.Provider value={value}>{children}</RoomsContext.Provider>;
}

export function useRooms() {
  const ctx = useContext(RoomsContext);
  if (!ctx) {
    throw new Error('useRooms must be used within a RoomsProvider');
  }
  return ctx;
}