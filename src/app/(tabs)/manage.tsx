import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import DueRow from '@/components/DueRow';
import { useBills } from '@/contexts/BillsContext';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useRooms } from '@/contexts/RoomsContext';
import { formatPeso } from '@/utils/billing';
import { computeDues } from '@/utils/dues';

type Segment = 'upcoming' | 'unpaid';

export default function ManageScreen() {
  const router = useRouter();
  const { rooms } = useRooms();
  const { getBill } = useBills(); // changes whenever bill records change
  const { getHouseById } = useBoardingHouses();
  const [segment, setSegment] = useState<Segment>('upcoming');

  const { upcoming, overdue } = useMemo(
    () => computeDues(rooms, getBill),
    [rooms, getBill]
  );

  const data = segment === 'upcoming' ? upcoming : overdue;
  const outstanding = data.reduce((sum, item) => sum + item.total, 0);

  return (
    <View style={styles.container}>
      <View style={styles.segmentBar}>
        <SegmentButton
          label={`Upcoming (${upcoming.length})`}
          active={segment === 'upcoming'}
          onPress={() => setSegment('upcoming')}
        />
        <SegmentButton
          label={`Unpaid (${overdue.length})`}
          active={segment === 'unpaid'}
          onPress={() => setSegment('unpaid')}
        />
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          data.length > 0 ? (
            <Text style={styles.summary}>
              {segment === 'upcoming' ? 'Expected: ' : 'Outstanding: '}
              {formatPeso(outstanding)}
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {segment === 'upcoming'
              ? 'No upcoming due dates.\nRegister a tenant to start tracking bills.'
              : 'No unpaid overdue bills. '}
          </Text>
        }
        renderItem={({ item }) => (
          <DueRow
            item={item}
            houseName={getHouseById(item.room.boardingHouseId)?.name ?? 'Unknown'}
            onPress={() => router.push(`/bill/${item.room.id}?period=${item.period}`)}
          />
        )}
      />
    </View>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segment, active && styles.segmentActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  segmentBar: {
    flexDirection: 'row',
    margin: 16,
    marginBottom: 0,
    padding: 4,
    borderRadius: 10,
    backgroundColor: '#E4E7EC',
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: 'white',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  segmentTextActive: {
    color: '#1A2B3C',
  },
  listContent: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  summary: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A2B3C',
    marginBottom: 4,
  },
  emptyText: {
    flex: 1,
    marginTop: 80,
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});