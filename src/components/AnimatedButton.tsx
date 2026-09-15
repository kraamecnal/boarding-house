import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
 
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
 
type AnimatedButtonProps = {
  label: string;
  onPress: () => void;
};
 
export default function AnimatedButton({ label, onPress }: AnimatedButtonProps) {
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
 
const styles = StyleSheet.create({
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
  text: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
 














