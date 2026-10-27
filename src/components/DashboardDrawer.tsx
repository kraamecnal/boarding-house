import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DashboardColors } from '@/constants/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function DashboardDrawer({ visible, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.6, 280);
  const translateX = useRef(new Animated.Value(-drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);

  useEffect(() => {
    if (!visible) return;
    isClosing.current = false;
    translateX.setValue(-drawerWidth);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, drawerWidth, translateX, visible]);

  const closeDrawer = (afterClose?: () => void) => {
    if (isClosing.current) return;
    isClosing.current = true;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: -drawerWidth,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) return;
      onClose();
      afterClose?.();
    });
  };

  const navigateTo = (path: '/billing-charges' | '/profile') => {
    closeDrawer(() => router.push(path));
  };

  return (
    <Modal
      animationType="none"
      onRequestClose={() => closeDrawer()}
      statusBarTranslucent
      transparent
      visible={visible}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close navigation menu"
          accessibilityRole="button"
          onPress={() => closeDrawer()}
          style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        </Pressable>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              top: Math.max(insets.top, 8) + 8,
              bottom: Math.max(insets.bottom, 8) + 8,
              transform: [{ translateX }],
            },
          ]}>
          <Text style={styles.title}>Menu</Text>
          <DrawerItem
            icon="receipt-outline"
            label="Billing charges"
            onPress={() => navigateTo('/billing-charges')}
          />
          <DrawerItem
            icon="person-outline"
            label="Profile"
            onPress={() => navigateTo('/profile')}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

function DrawerItem({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}>
      <Ionicons color={DashboardColors.dark} name={icon} size={21} />
      <Text style={styles.itemLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(30, 58, 138, 0.28)',
  },
  drawer: {
    position: 'absolute',
    left: 0,
    paddingHorizontal: 18,
    paddingTop: 28,
    borderRadius: 28,
    backgroundColor: DashboardColors.white,
    elevation: 12,
    shadowColor: DashboardColors.dark,
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  title: {
    marginBottom: 20,
    color: DashboardColors.dark,
    fontSize: 20,
    fontWeight: '700',
  },
  item: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  itemPressed: {
    backgroundColor: DashboardColors.pale,
  },
  itemLabel: {
    color: DashboardColors.dark,
    fontSize: 15,
    fontWeight: '600',
  },
});
