export type Room = {
  id: string;
  name: string;
  status: 'available' | 'occupied' | 'maintenance';
};

export type BoardingHouse = {
  id: string;     
  name: string;     
  rooms: Room[];
};

export const boardingHouses: Record<string, BoardingHouse> = {
  '1': { id: '1', name: 'BH1', rooms: [] },
  '2': { id: '2', name: 'BH2', rooms: [] },
  '3': { id: '3', name: 'BH3', rooms: [] },
  '4': { id: '4', name: 'BH4', rooms: [] },
};

export const boardingHouseList: BoardingHouse[] = Object.values(boardingHouses);
