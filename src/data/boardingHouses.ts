export type Room = {
  id: string;
  name: string;
  status: 'available' | 'occupied' | 'maintenance';
};

export type BoardingHouse = {
  id: string;       // used in the URL: /bh/1, /bh/2, ...
  name: string;      // display name, e.g. "BH1"
  rooms: Room[];
};

// Add a new boarding house here and it automatically gets:
// - a button on Home/Explore
// - a working /bh/[id] page
// No new screen files needed.
export const boardingHouses: Record<string, BoardingHouse> = {
  '1': { id: '1', name: 'BH1', rooms: [] },
  '2': { id: '2', name: 'BH2', rooms: [] },
  '3': { id: '3', name: 'BH3', rooms: [] },
  '4': { id: '4', name: 'BH4', rooms: [] },
};

// Convenience array for mapping over in the UI (buttons, lists, etc.)
export const boardingHouseList: BoardingHouse[] = Object.values(boardingHouses);