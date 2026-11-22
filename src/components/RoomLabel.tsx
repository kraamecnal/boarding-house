import type { StyleProp, TextStyle } from 'react-native';
import { StyleSheet, Text } from 'react-native';

type Props = {
  boardingHouseName?: string | null;
  roomName?: string | null;
  style?: StyleProp<TextStyle>;
};

function roomLabelParts(roomName?: string | null, boardingHouseName?: string | null) {
  const room = roomName?.trim() ?? '';
  const house = boardingHouseName?.trim() ?? '';
  const displayedRoom = room && !/^room\s/i.test(room) ? `${room}` : room;

  return { room, house, displayedRoom };
}

export function formatRoomLabel(
  roomName?: string | null,
  boardingHouseName?: string | null,
): string {
  const { house, displayedRoom } = roomLabelParts(roomName, boardingHouseName);
  if (house && displayedRoom) return `${house} · ${displayedRoom}`;
  return displayedRoom || house;
}

export function formatRoomSentenceLabel(
  roomName?: string | null,
  boardingHouseName?: string | null,
): string {
  const { room, house } = roomLabelParts(roomName, boardingHouseName);
  if (room && house) return `${room} at ${house}`;
  return room || house || 'this room';
}

export default function RoomLabel({ boardingHouseName, roomName, style }: Props) {
  const label = formatRoomLabel(roomName, boardingHouseName);
  const accessibleLabel = formatRoomSentenceLabel(roomName, boardingHouseName);

  return (
    <Text
      accessibilityLabel={accessibleLabel}
      style={[styles.label, style]}
      textBreakStrategy="highQuality">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    flexShrink: 1,
  },
});
