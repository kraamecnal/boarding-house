import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DashboardDrawer from '@/components/DashboardDrawer';
import RoomLabel from '@/components/RoomLabel';
import { DashboardColors } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useBills } from '@/contexts/BillsContext';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useRooms } from '@/contexts/RoomsContext';
import { formatPeso, formatShortDate, periodLabel } from '@/utils/billing';
import { computeDues, type DueItem } from '@/utils/dues';

export default function ManageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ownerDisplayName } = useAuth();
  const { unreadCount } = useNotifications();
  const {
    rooms,
    isLoading: isLoadingRooms,
    loadError: roomsError,
    reload: reloadRooms,
  } = useRooms();
  const {
    boardingHouses,
    isLoading: isLoadingHouses,
    loadError: housesError,
    reload: reloadHouses,
  } = useBoardingHouses();
  const { getBill, isLoading: isLoadingBills, loadError: billsError, reload: reloadBills } = useBills();
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);

  const { upcoming, overdue } = useMemo(
    () => computeDues(rooms, getBill),
    [getBill, rooms],
  );
  const houseNames = useMemo(
    () => new Map(boardingHouses.map((house) => [house.id, house.name])),
    [boardingHouses],
  );
  const filterHouses = useMemo(
    () => [...boardingHouses].sort((a, b) => a.name.localeCompare(b.name)),
    [boardingHouses],
  );
  const filteredUpcoming = useMemo(
    () =>
      selectedHouseId
        ? upcoming.filter((item) => item.room.boardingHouseId === selectedHouseId)
        : upcoming,
    [selectedHouseId, upcoming],
  );
  const selectedHouseName =
    selectedHouseId === null ? null : houseNames.get(selectedHouseId) ?? 'this boarding house';

  useFocusEffect(
    useCallback(
      () => () => {
        setSelectedHouseId(null);
      },
      [],
    ),
  );
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
            accessibilityLabel={
              unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
            }
            accessibilityRole="button"
            onPress={() => router.push('/notifications')}
            style={styles.headerButton}>
            <View>
              <Ionicons color={DashboardColors.dark} name="notifications-outline" size={23} />
              {unreadCount > 0 && (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeLabel}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        </View>

        <Text style={styles.greeting}>HELLO, {ownerDisplayName}</Text>

        {isLoadingBills || isLoadingRooms || isLoadingHouses ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={DashboardColors.primary} size="large" />
          </View>
        ) : billsError || roomsError || housesError ? (
          <View style={styles.stateCard}>
            <Text accessibilityLiveRegion="polite" style={styles.emptyMessage}>
              {roomsError ?? housesError ?? billsError}
            </Text>
            <Pressable
              onPress={() => {
                reloadRooms();
                reloadHouses();
                reloadBills();
              }}
              style={styles.retryButton}
            >
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {filterHouses.length >= 3 && (
              <View style={styles.houseFiltersSection}>
                <ScrollView
                  accessibilityLabel="Filter upcoming bills by boarding house"
                  contentContainerStyle={styles.houseFilters}
                  horizontal
                  showsHorizontalScrollIndicator={false}>
                  <HouseFilterChip
                    label="All"
                    selected={selectedHouseId === null}
                    onPress={() => setSelectedHouseId(null)}
                  />
                  {filterHouses.map((house) => (
                    <HouseFilterChip
                      key={house.id}
                      label={house.name}
                      selected={selectedHouseId === house.id}
                      onPress={() => setSelectedHouseId(house.id)}
                    />
                  ))}
                </ScrollView>
              </View>
            )}
            <DashboardSection
              title="Upcoming monthly due dates"
              items={filteredUpcoming}
              emptyMessage={
                selectedHouseName
                  ? `No upcoming bills for ${selectedHouseName}.`
                  : 'No upcoming due dates yet.'
              }
              houseNames={houseNames}
              onItemPress={(item) =>
                router.push(`/bill/${item.room.id}?period=${item.period}`)
              }
            />
            <DashboardSection
              title="Unpaid tenants"
              items={overdue}
              emptyMessage="No unpaid overdue bills."
              houseNames={houseNames}
              onItemPress={(item) =>
                router.push(`/bill/${item.room.id}?period=${item.period}`)
              }
            />
          </>
        )}
      </ScrollView>

      <DashboardDrawer visible={drawerVisible} onClose={() => setDrawerVisible(false)} />
    </View>
  );
}

function DashboardSection({
  title,
  items,
  emptyMessage,
  houseNames,
  onItemPress,
}: {
  title: string;
  items: DueItem[];
  emptyMessage: string;
  houseNames: Map<string, string>;
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
                <RoomLabel
                  boardingHouseName={houseNames.get(item.room.boardingHouseId)}
                  roomName={item.room.roomName}
                  style={styles.roomLabel}
                />
                <Text style={styles.dueDetail}>
                  {periodLabel(item.period)} · {formatShortDate(item.dueDate)}
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

function HouseFilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.houseFilterChip, selected && styles.houseFilterChipSelected]}>
      <Text style={[styles.houseFilterLabel, selected && styles.houseFilterLabelSelected]}>
        {label}
      </Text>
    </Pressable>
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
  notificationBadge: {
    position: 'absolute',
    top: -7,
    right: -9,
    minWidth: 17,
    height: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderRadius: 9,
    backgroundColor: '#DC2626',
  },
  notificationBadgeLabel: {
    color: DashboardColors.white,
    fontSize: 9,
    fontWeight: '800',
  },
  greeting: {
    marginTop: 4,
    color: DashboardColors.dark,
    fontSize: 23,
    fontWeight: '800',
    fontStyle: 'italic',
  },
  houseFiltersSection: {
    marginBottom: -12,
  },
  houseFilters: {
    alignItems: 'center',
    gap: 8,
    paddingRight: 20,
  },
  houseFilterChip: {
    maxWidth: 240,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 20,
    backgroundColor: DashboardColors.white,
  },
  houseFilterChipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#2563EB',
  },
  houseFilterLabel: {
    color: DashboardColors.text,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  houseFilterLabelSelected: {
    color: DashboardColors.white,
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
  stateCard: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 18,
    borderRadius: 16,
    backgroundColor: DashboardColors.pale,
  },
  retryButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: DashboardColors.white,
  },
  retryLabel: {
    color: DashboardColors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  dueItem: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  roomLabel: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
  },
  dueDetail: {
    color: DashboardColors.neutral,
    fontSize: 11,
  },
  amount: {
    flexShrink: 0,
    color: DashboardColors.dark,
    fontSize: 13,
    fontWeight: '700',
  },
});