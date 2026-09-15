import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import AnimatedButton from '../components/AnimatedButton';

export default function IndexScreen() {
  const router = useRouter();

  const buttons = [
    { label: 'BH1', route: '/bh1' },
    { label: 'BH2', route: '/bh2' },
    { label: 'BH3', route: '/bh3' },
    { label: 'BH4', route: '/bh4' },
  ] as const;

  return (
    <View style={styles.container}>
      <Text style={styles.welcomeText}>HELLO, Admin</Text>
      {buttons.map(({ label, route }) => (
        <AnimatedButton key={label} label={label} onPress={() => router.push(route)} />
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