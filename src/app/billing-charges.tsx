import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import DueRow from '@/components/DueRow';
import { DashboardColors } from '@/constants/theme';
import { useBills } from '@/contexts/BillsContext';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useRooms } from '@/contexts/RoomsContext';
import { formatPeso } from '@/utils/billing';
import { computeDues } from '@/utils/dues';

type Segment = 'upcoming' | 'unpaid';

export default function BillingChargesScreen() {
  const router = useRouter();
  const { rooms } = useRooms();
  const { getBill } = useBills();
  const { getHouseById } = useBoardingHouses();
  const [segment, setSegment] = useState<Segment>('upcoming');

  const { upcoming, overdue } = useMemo(
    () => computeDues(rooms, getBill),
    [getBill, rooms],
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
        contentContainerStyle={styles.listContent}
        data={data}
        keyExtractor={(item) => item.key}
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
              : 'No unpaid overdue bills.'}
          </Text>
        }
        renderItem={({ item }) => (
          <DueRow
            houseName={getHouseById(item.room.boardingHouseId)?.name ?? 'Unknown'}
            item={item}
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
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.segment, active && styles.segmentActive]}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DashboardColors.white,
  },
  segmentBar: {
    flexDirection: 'row',
    margin: 16,
    marginBottom: 0,
    padding: 4,
    borderRadius: 10,
    backgroundColor: DashboardColors.pale,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: DashboardColors.white,
  },
  segmentText: {
    color: DashboardColors.neutral,
    fontSize: 14,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: DashboardColors.dark,
  },
  listContent: {
    flexGrow: 1,
    padding: 16,
    gap: 12,
  },
  summary: {
    marginBottom: 4,
    color: DashboardColors.dark,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    flex: 1,
    marginTop: 80,
    paddingHorizontal: 40,
    color: DashboardColors.neutral,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
});
