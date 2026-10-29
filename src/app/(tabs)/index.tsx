import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AnimatedFAB from '@/components/AnimatedFAB';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useRooms } from '@/contexts/RoomsContext';

export default function BoardingHousesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { boardingHouses, isLoading, loadError, reload } = useBoardingHouses();
  const { getRoomsForHouse, loadError: roomsError } = useRooms();

  return (
    <View style={styles.container}>
      <FlatList
        data={boardingHouses}
        keyExtractor={(house) => house.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 8 },
        ]}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.title}>Boarding houses</Text>
            {roomsError && <Text style={styles.loadError}>{roomsError}</Text>}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color="#2563EB" size="large" />
            </View>
          ) : loadError ? (
            <View style={styles.emptyState}>
              <Text accessibilityLiveRegion="polite" style={styles.loadError}>{loadError}</Text>
              <Pressable accessibilityRole="button" onPress={reload} style={styles.emptyAction}>
                <Text style={styles.emptyActionLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No boarding houses yet.</Text>
              <Text style={styles.emptyDescription}>
                Add your first boarding house to get started.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/register-house')}
                style={({ pressed }) => [
                  styles.emptyAction,
                  pressed && styles.emptyActionPressed,
                ]}
              >
                <Text style={styles.emptyActionLabel}>Add boarding house</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item }) => {
          const houseRooms = getRoomsForHouse(item.id);
          const roomCount = houseRooms.length;
          const occupiedCount = houseRooms.filter((room) => room.status === 'occupied').length;
          return (
            <Pressable
              onPress={() => router.push(`/bh/${item.id}`)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name}, ${item.address}, ${roomCount} ${
                roomCount === 1 ? 'room' : 'rooms'
              }, ${occupiedCount} occupied`}
            >
              <View style={styles.cardText}>
                <Text style={styles.houseName}>{item.name}</Text>
                <Text style={styles.address}>{item.address}</Text>
                <Text style={styles.tenants}>
                  {roomCount} {roomCount === 1 ? 'room' : 'rooms'} · {occupiedCount} occupied
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color="#8A94A6" />
            </Pressable>
          );
        }}
      />

      <AnimatedFAB
        onPress={() => router.push('/register-house')}
        accessibilityLabel="Register a new boarding house"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 110,
    gap: 12,
    flexGrow: 1,
  },
  listHeader: {
    gap: 6,
  },
  title: {
    color: '#1E3A8A',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyTitle: {
    color: '#1E3A8A',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyDescription: {
    marginTop: 6,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  loadError: {
    color: '#B42318',
    fontSize: 13,
    textAlign: 'center',
  },
  emptyAction: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 18,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
  },
  emptyActionPressed: {
    opacity: 0.75,
  },
  emptyActionLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  cardPressed: {
    opacity: 0.8,
  },
  cardText: {
    flex: 1,
    gap: 3,
    paddingRight: 12,
  },
  houseName: {
    color: '#1E3A8A',
    fontSize: 18,
    fontWeight: '700',
  },
  address: {
    color: '#64748B',
    fontSize: 14,
  },
  tenants: {
    marginTop: 3,
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
});