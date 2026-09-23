import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import AnimatedFAB from '@/components/AnimatedFAB';
import { useRooms } from '@/contexts/RoomsContext';
import { boardingHouses } from '@/data/boardingHouses';

export default function BoardingHouseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const house = boardingHouses[id as string];
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

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${house.name} Rooms` }} />

      {rooms.length === 0 ? (
        <Text style={styles.emptyText}>
          No tenants registered yet for {house.name}.{'\n'}Tap the + button to add one.
        </Text>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(room) => room.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.tenantName}>
                {item.firstName} {item.lastName}
              </Text>
              <Text style={styles.cardLine}>{item.email}</Text>
              <Text style={styles.cardLine}>{item.contactNumber}</Text>
              <Text style={styles.cardLine}>
                ₱{item.monthlyRent.toLocaleString()} / month
              </Text>
              <Text style={styles.cardLine}>
                {item.startDate} → {item.dueDate}
              </Text>
            </View>
          )}
        />
      )}

      <AnimatedFAB onPress={() => router.push(`/bh/${id}/room/new`)} />
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
  tenantName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A2B3C',
  },
  cardLine: {
    fontSize: 14,
    color: '#555',
  },
});