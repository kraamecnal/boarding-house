import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function AnimatedButton({ label, onPress }: { label: string; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.92,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedPressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      style={[styles.button, { transform: [{ scale }] }]}
    >
      <Text style={styles.text}>{label}</Text>
    </AnimatedPressable>
  );
}

export default function ExploreScreen() {
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

  button: {
    backgroundColor: '#007AFF',
    width: 200,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },

  welcomeText: {
    color: '#1A2B3C',
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },

  text: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
});