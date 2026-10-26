import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AnimatedFAB from '@/components/AnimatedFAB';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useRooms } from '@/contexts/RoomsContext';

export default function BoardingHousesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { boardingHouses } = useBoardingHouses();
  const { getRoomsForHouse } = useRooms();

  return (
    <View style={styles.container}>
      <FlatList
        data={boardingHouses}
        keyExtractor={(house) => house.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 24 },
        ]}
        ListHeaderComponent={<Text style={styles.welcomeText}>HELLO, Admin</Text>}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No boarding houses yet.{'\n'}Tap the + button to register one.
          </Text>
        }
        renderItem={({ item }) => {
          const tenantCount = getRoomsForHouse(item.id).length;
          return (
            <Pressable
              onPress={() => router.push(`/bh/${item.id}`)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name}, ${item.address}`}
            >
              <View style={styles.cardText}>
                <Text style={styles.houseName}>{item.name}</Text>
                <Text style={styles.address}>{item.address}</Text>
                <Text style={styles.tenants}>
                  {tenantCount} {tenantCount === 1 ? 'tenant' : 'tenants'}
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
    backgroundColor: '#f8f9fa',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 110, // keeps the last card clear of the FAB
    gap: 12,
    flexGrow: 1,
  },
  welcomeText: {
    color: '#1A2B3C',
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 12,
  },
  emptyText: {
    marginTop: 60,
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  cardPressed: { opacity: 0.85 },
  cardText: { flex: 1, gap: 2 },
  houseName: { fontSize: 18, fontWeight: '700', color: '#1A2B3C' },
  address: { fontSize: 14, color: '#555' },
  tenants: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginTop: 4 },
});