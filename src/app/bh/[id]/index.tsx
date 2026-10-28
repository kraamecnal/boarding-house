import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import AnimatedFAB from '@/components/AnimatedFAB';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { isOccupied, useRooms } from '@/contexts/RoomsContext';
import { formatPeso } from '@/utils/billing';

export default function BoardingHouseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getHouseById } = useBoardingHouses();
  const house = getHouseById(id as string);
  const { getRoomsForHouse } = useRooms();

  if (!house) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <Text style={styles.emptyText}>Boarding house "{id}" not found.</Text>
      </View>
    );
  }

  const rooms = getRoomsForHouse(id as string);
  const occupiedCount = rooms.filter((room) => room.status === 'occupied').length;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${house.name} Rooms` }} />

      {rooms.length === 0 ? (
        <Text style={styles.emptyText}>
          No rooms registered yet for {house.name}.{'\n'}Tap the + button to add one.
        </Text>
      ) : (
        <FlatList
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={styles.houseAddress}>{house.address}</Text>
              <Text style={styles.houseSummary}>
                {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} · {occupiedCount} occupied
              </Text>
            </View>
          }
          data={rooms}
          keyExtractor={(room) => room.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            if (!isOccupied(item)) {
              return (
                <Pressable
                  onPress={() => router.push(`/bh/${id}/room/${item.id}/tenant`)}
                  style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.roomName} is vacant. Register a tenant.`}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.roomTitle}>{item.roomName}</Text>
                    <StatusBadge occupied={false} />
                  </View>
                  <Text style={styles.cardLine}>{formatPeso(item.monthlyRate)} / month</Text>
                  <Text style={styles.cta}>Tap to register a tenant</Text>
                </Pressable>
              );
            }

            const { tenant } = item;

            return (
              <Pressable
                onPress={() => router.push(`/bh/${id}/room/${item.id}`)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.roomName}, ${tenant.firstName} ${tenant.lastName}`}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.roomTitle}>{item.roomName}</Text>
                  <StatusBadge occupied />
                </View>

                <View style={styles.tenantRow}>
                  <Text style={styles.tenantName}>
                    {tenant.firstName} {tenant.lastName}
                  </Text>
                  <Ionicons name="chevron-forward" size={22} color="#8A94A6" />
                </View>

                <Text style={styles.cardLine}>{formatPeso(item.monthlyRate)} / month</Text>
              </Pressable>
            );
          }}
        />
      )}

      <AnimatedFAB
        onPress={() => router.push(`/bh/${id}/room/new`)}
        accessibilityLabel="Register a new room"
      />
    </View>
  );
}

function StatusBadge({ occupied }: { occupied: boolean }) {
  return (
    <View style={[styles.badge, occupied ? styles.badgeOccupied : styles.badgeVacant]}>
      <Text style={[styles.badgeText, occupied ? styles.badgeTextOccupied : styles.badgeTextVacant]}>
        {occupied ? 'Occupied' : 'Vacant'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
    paddingBottom: 110, // keeps the last card clear of the FAB
    gap: 12,
  },
  header: {
    marginBottom: 4,
    gap: 2,
  },
  houseAddress: {
    fontSize: 14,
    color: '#6B7280',
  },
  houseSummary: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A2B3C',
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
  },
  roomTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A2B3C',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeVacant: { backgroundColor: '#F2F4F7' },
  badgeOccupied: { backgroundColor: '#DBEAFE' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeTextVacant: { color: '#475467' },
  badgeTextOccupied: { color: '#1D4ED8' },
  tenantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tenantName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1A2B3C',
  },
  cardLine: {
    fontSize: 14,
    color: '#555',
  },
  cta: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
});