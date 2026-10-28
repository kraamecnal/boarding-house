import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DashboardDrawer from '@/components/DashboardDrawer';
import { DashboardColors } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useBills } from '@/contexts/BillsContext';
import { useRooms } from '@/contexts/RoomsContext';
import { formatPeso, formatShortDate, periodLabel } from '@/utils/billing';
import { computeDues, type DueItem } from '@/utils/dues';

export default function ManageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { rooms } = useRooms();
  const { getBill } = useBills();
  const [drawerVisible, setDrawerVisible] = useState(false);

  const { upcoming, overdue } = useMemo(
    () => computeDues(rooms, getBill),
    [getBill, rooms],
  );
  const metadata = session?.user.user_metadata ?? {};
  const metadataName = [metadata.full_name, metadata.name, metadata.display_name].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  const username = metadataName?.trim() ?? session?.user.email?.split('@')[0] ?? 'Admin';

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Open settings menu"
            accessibilityRole="button"
            accessibilityState={{ expanded: drawerVisible }}
            onPress={() => setDrawerVisible(true)}
            style={styles.headerButton}>
            <Ionicons color={DashboardColors.dark} name="settings-outline" size={24} />
          </Pressable>
          <Pressable
            accessibilityLabel="Notifications"
            accessibilityRole="button"
            onPress={() => Alert.alert('Notifications', 'Notifications are not available yet.')}
            style={styles.headerButton}>
            <Ionicons color={DashboardColors.dark} name="notifications-outline" size={23} />
          </Pressable>
        </View>

        <Text style={styles.greeting}>HELLO, {username}</Text>

        <DashboardSection
          title="Upcoming monthly due dates"
          items={upcoming}
          emptyMessage="No upcoming due dates yet."
          onItemPress={(item) =>
            router.push(`/bill/${item.room.id}?period=${item.period}`)
          }
        />
        <DashboardSection
          title="Unpaid tenants"
          items={overdue}
          emptyMessage="No unpaid overdue bills."
          onItemPress={(item) =>
            router.push(`/bill/${item.room.id}?period=${item.period}`)
          }
        />
      </ScrollView>

      <DashboardDrawer visible={drawerVisible} onClose={() => setDrawerVisible(false)} />
    </View>
  );
}

function DashboardSection({
  title,
  items,
  emptyMessage,
  onItemPress,
}: {
  title: string;
  items: DueItem[];
  emptyMessage: string;
  onItemPress: (item: DueItem) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionCard}>
        {items.length === 0 ? (
          <Text style={styles.emptyMessage}>{emptyMessage}</Text>
        ) : (
          items.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.key}
              onPress={() => onItemPress(item)}
              style={({ pressed }) => [styles.dueItem, pressed && styles.dueItemPressed]}>
              <View style={styles.dueItemCopy}>
                <Text numberOfLines={1} style={styles.tenantName}>
                  {item.room.tenant.firstName} {item.room.tenant.lastName}
                </Text>
                <Text style={styles.dueDetail}>
                  {item.room.roomName} · {periodLabel(item.period)} · {formatShortDate(item.dueDate)}
                </Text>
              </View>
              <Text style={styles.amount}>{formatPeso(item.total)}</Text>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DashboardColors.white,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 24,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 22,
  },
  greeting: {
    marginTop: 4,
    color: DashboardColors.dark,
    fontSize: 23,
    fontWeight: '800',
    fontStyle: 'italic',
  },
  section: {
    gap: 8,
  },
  sectionHeading: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: DashboardColors.dark,
    fontSize: 14,
    fontWeight: '700',
  },
  sectionCard: {
    minHeight: 132,
    justifyContent: 'center',
    padding: 14,
    gap: 8,
    borderWidth: 2,
    borderColor: DashboardColors.border,
    borderRadius: 28,
    backgroundColor: DashboardColors.pale,
  },
  emptyMessage: {
    color: DashboardColors.neutral,
    fontSize: 14,
    textAlign: 'center',
  },
  dueItem: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  dueItemPressed: {
    backgroundColor: DashboardColors.light,
  },
  dueItemCopy: {
    flex: 1,
    gap: 3,
  },
  tenantName: {
    color: DashboardColors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  dueDetail: {
    color: DashboardColors.neutral,
    fontSize: 11,
  },
  amount: {
    color: DashboardColors.dark,
    fontSize: 13,
    fontWeight: '700',
  },
});