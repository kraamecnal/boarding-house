import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import AnimatedButton from '@/components/AnimatedButton';
import { boardingHouseList } from '@/data/boardingHouses';

export default function IndexScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.welcomeText}>HELLO, Admin</Text>
      {boardingHouseList.map((house) => (
        <AnimatedButton
          key={house.id}
          label={house.name}
          onPress={() => router.push(`/bh/${house.id}`)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'white',
  },
  welcomeText: {
    color: '#1A2B3C',
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
});