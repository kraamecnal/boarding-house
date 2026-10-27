import { createContext, ReactNode, useContext, useMemo, useReducer } from 'react';

export type RoomStatus = 'vacant' | 'occupied';

export type Tenant = {
  firstName: string;
  lastName: string;
  email: string;
  contactNumber: string;
  startDate: string; // 'YYYY-MM-DD'
  dueDate: string; // 'YYYY-MM-DD'
  idImageUri: string;
  contractImageUri: string;
};

export type Room = {
  id: string;
  boardingHouseId: string;
  roomName: string;
  monthlyRate: number;
  status: RoomStatus; // 'vacant' until a tenant is registered
  tenant: Tenant | null;
  createdAt: string;
};

/** A room that is guaranteed to have a tenant. */
export type OccupiedRoom = Room & { status: 'occupied'; tenant: Tenant };

export function isOccupied(room: Room): room is OccupiedRoom {
  return room.status === 'occupied' && room.tenant !== null;
}

type NewRoomInput = Pick<Room, 'boardingHouseId' | 'roomName' | 'monthlyRate'>;
export type NewTenantInput = Omit<Tenant, 'dueDate'>;

type RoomsAction =
  | { type: 'ADD_ROOM'; payload: Room }
  | { type: 'REMOVE_ROOM'; payload: { id: string } }
  | { type: 'ASSIGN_TENANT'; payload: { roomId: string; tenant: Tenant } }
  | { type: 'SET_ROOMS'; payload: Room[] };

function roomsReducer(state: Room[], action: RoomsAction): Room[] {
  switch (action.type) {
    case 'ADD_ROOM':
      return [...state, action.payload];
    case 'REMOVE_ROOM':
      return state.filter((room) => room.id !== action.payload.id);
    case 'ASSIGN_TENANT':
      return state.map((room) =>
        room.id === action.payload.roomId && room.status === 'vacant'
          ? { ...room, status: 'occupied', tenant: action.payload.tenant }
          : room
      );
    case 'SET_ROOMS':
      return action.payload;
    default:
      return state;
  }
}

export function addOneMonth(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const targetMonthIndex = month;
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
  isRoomNameTaken: (boardingHouseId: string, roomName: string) => boolean;
  addRoom: (input: NewRoomInput) => void;
  assignTenant: (roomId: string, input: NewTenantInput) => void;
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
      isRoomNameTaken: (boardingHouseId, roomName) =>
        rooms.some(
          (room) =>
            room.boardingHouseId === boardingHouseId &&
            room.roomName.trim().toLowerCase() === roomName.trim().toLowerCase()
        ),
      addRoom: (input) => {
        const room: Room = {
          ...input,
          status: 'vacant',
          tenant: null,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'ADD_ROOM', payload: room });
      },
      assignTenant: (roomId, input) => {
        const tenant: Tenant = { ...input, dueDate: addOneMonth(input.startDate) };
        dispatch({ type: 'ASSIGN_TENANT', payload: { roomId, tenant } });
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