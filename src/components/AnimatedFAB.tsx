import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type AnimatedFABProps = {
  onPress: () => void;
  label?: string;
  accessibilityLabel?: string;
};

export default function AnimatedFAB({
  onPress,
  label = '+',
  accessibilityLabel = 'Register a new room'}: AnimatedFABProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.9,
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
      style={[styles.fab, { transform: [{ scale }] }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.icon}>{label}</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  icon: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '600',
    marginTop: -2,
  },
});