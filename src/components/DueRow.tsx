import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatPeso, formatShortDate, periodLabel } from '@/utils/billing';
import type { DueItem } from '@/utils/dues';

type Props = {
  item: DueItem;
  houseName: string;
  onPress: () => void;
};

function dueText(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    return `${n} day${n === 1 ? '' : 's'} overdue`;
  }
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

function toneFor(days: number) {
  if (days < 0) return styles.toneOverdue;
  if (days <= 7) return styles.toneSoon;
  return styles.toneLater;
}

export default function DueRow({ item, houseName, onPress }: Props) {
  const { room, period, dueDate, daysUntilDue, total, electricityEntered } = item;
  const { tenant } = room;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${room.roomName}, ${tenant.firstName} ${tenant.lastName}, ${dueText(daysUntilDue)}`}
    >
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text style={styles.subtitle}>
            {houseName} · {room.roomName}
          </Text>
          <Text style={styles.name}>
            {tenant.firstName} {tenant.lastName}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#8A94A6" />
      </View>

      <View style={styles.row}>
        <Text style={[styles.status, toneFor(daysUntilDue)]}>{dueText(daysUntilDue)}</Text>
        <Text style={styles.detail}>{formatShortDate(dueDate)}</Text>
      </View>

      <Text style={styles.detail}>{periodLabel(period)} bill</Text>

      {electricityEntered ? (
        <Text style={styles.amount}>{formatPeso(total)}</Text>
      ) : (
        <Text style={styles.detail}>
          Electricity not entered · {formatPeso(total)} so far
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  cardPressed: { opacity: 0.85 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  titles: { flex: 1 },
  subtitle: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  name: { fontSize: 17, fontWeight: '700', color: '#1A2B3C' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  status: { fontSize: 14, fontWeight: '700' },
  toneOverdue: { color: '#B42318' },
  toneSoon: { color: '#B54708' },
  toneLater: { color: '#067647' },
  detail: { fontSize: 13, color: '#6B7280' },
  amount: { fontSize: 15, fontWeight: '700', color: '#1A2B3C', marginTop: 2 },
});