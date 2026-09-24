import { createContext, ReactNode, useContext, useMemo, useReducer } from 'react';
 
export type Room = {
  id: string;
  boardingHouseId: string;
  roomName: string;
  firstName: string;
  lastName: string;
  email: string;
  contactNumber: string;
  startDate: string; 
  dueDate: string; 
  monthlyRent: number;
  idImageUri: string | null; 
  createdAt: string;
};
 
type NewRoomInput = Omit<Room, 'id' | 'createdAt' | 'dueDate'>;
 
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
 
export function addOneMonth(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const targetMonthIndex = month; // `month` is 1-indexed, so this is already "next month" 0-indexed
  const daysInTargetMonth = new Date(year, targetMonthIndex + 1, 0).getDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  const result = new Date(year, targetMonthIndex, clampedDay);
 
  const yyyy = result.getFullYear();
  const mm = String(result.getMonth() + 1).padStart(2, '0');
  const dd = String(result.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
 
type RoomsContextValue = {
  rooms: Room[];
  getRoomsForHouse: (boardingHouseId: string) => Room[];
  getRoomById: (id: string) => Room | undefined;
  addRoom: (input: NewRoomInput) => void;
  removeRoom: (id: string) => void;
};
 
const RoomsContext = createContext<RoomsContextValue | undefined>(undefined);
 
export function RoomsProvider({ children }: { children: ReactNode }) {
  const [rooms, dispatch] = useReducer(roomsReducer, []);
 
  const value = useMemo<RoomsContextValue>(
    () => ({
      rooms,
      getRoomsForHouse: (boardingHouseId) =>
        rooms.filter((room) => room.boardingHouseId === boardingHouseId),
      getRoomById: (id) => rooms.find((room) => room.id === id),
      addRoom: (input) => {
        const room: Room = {
          ...input,
          dueDate: addOneMonth(input.startDate),
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
