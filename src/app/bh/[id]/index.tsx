import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import AnimatedFAB from '@/components/AnimatedFAB';
import { useBills } from '@/contexts/BillsContext';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useRooms } from '@/contexts/RoomsContext';
import { computeTotals, currentPeriod, formatPeso, periodLabel } from '@/utils/billing';

export default function BoardingHouseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getHouseById } = useBoardingHouses();
  const house = getHouseById(id as string);
  const { getRoomsForHouse } = useRooms();
  const { records, getBill } = useBills(); 

  if (!house) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <Text style={styles.emptyText}>Boarding house "{id}" not found.</Text>
      </View>
    );
  }

  const rooms = getRoomsForHouse(id as string);
  const period = currentPeriod();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${house.name} Rooms` }} />

      {rooms.length === 0 ? (
        <Text style={styles.emptyText}>
          No tenants registered yet for {house.name}.{'\n'}Tap the + button to add one.
        </Text>
      ) : (
        <FlatList
          ListHeaderComponent={<Text style={styles.houseAddress}>{house.address}</Text>}
          data={rooms}
          extraData={records} 
          keyExtractor={(room) => room.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const record = getBill(item.id, period);
            const totals = computeTotals(item.monthlyRent, record.electricity);
            const isPaid = record.status === 'paid';

            return (
              <Pressable
                onPress={() => router.push(`/bill/${item.id}`)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Open monthly bill for ${item.roomName}, ${item.firstName} ${item.lastName}`}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitles}>
                    <Text style={styles.roomName}>{item.roomName}</Text>
                    <Text style={styles.tenantName}>
                      {item.firstName} {item.lastName}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={22} color="#8A94A6" />
                </View>

                <Text style={styles.cardLine}>{item.email}</Text>
                <Text style={styles.cardLine}>{item.contactNumber}</Text>
                <Text style={styles.cardLine}>
                  ₱{item.monthlyRent.toLocaleString()} / month
                </Text>
                <Text style={styles.cardLine}>
                  {item.startDate} → {item.dueDate}
                </Text>

                <View style={styles.billRow}>
                  <Text style={styles.billPeriod}>{periodLabel(period)} bill</Text>
                  {record.electricity === '' && !isPaid ? (
                    <Text style={styles.billMuted}>Electricity not entered yet</Text>
                  ) : (
                    <Text style={[styles.billStatus, isPaid ? styles.paid : styles.unpaid]}>
                      {formatPeso(totals.total)} · {isPaid ? 'Paid' : 'Unpaid'}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <AnimatedFAB onPress={() => router.push(`/bh/${id}/room/new`)} />
    </View>
  );
}

const styles = StyleSheet.create({
  houseAddress: {
  fontSize: 14,
  color: '#6B7280',
  marginBottom: 4,
  },

  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  emptyText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingHorizontal: 40,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
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
  cardPressed: {
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cardTitles: {
    flex: 1,
  },
  roomName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  tenantName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A2B3C',
  },
  cardLine: {
    fontSize: 14,
    color: '#555',
  },
  billRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E4E7EC',
    gap: 2,
  },
  billPeriod: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A2B3C',
  },
  billMuted: {
    fontSize: 13,
    color: '#6B7280',
  },
  billStatus: {
    fontSize: 13,
    fontWeight: '600',
  },
  paid: {
    color: '#067647',
  },
  unpaid: {
    color: '#B42318',
  },
});
