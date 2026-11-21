import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  GestureResponderEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AnimatedFAB from '@/components/AnimatedFAB';
import RoomEditModal from '@/components/RoomEditModal';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { isOccupied, useRooms, type Room } from '@/contexts/RoomsContext';
import { formatPeso } from '@/utils/billing';
import { getSupabaseClient } from '@/utils/supabase';

function getDeleteErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error &&
      typeof error.message === 'string') return error.message;
  return 'Could not delete the selected rooms.';
}

export default function BoardingHouseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(() => new Set());
  const [isConfirmVisible, setIsConfirmVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    room: Room;
    left: number;
    top: number;
  } | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const longPressHandledRef = useRef(false);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const cancelDeleteMode = () => {
    if (isDeleting) return;
    setContextMenu(null);
    setDeleteMode(false);
    setSelectedRoomIds(new Set());
    setIsConfirmVisible(false);
    setDeleteError(null);
  };
  usePreventRemove(deleteMode, cancelDeleteMode);

  const toggleRoomSelection = (roomId: string) => {
    setSelectedRoomIds((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };

  const requestDeletion = () => {
    if (selectedRoomIds.size === 0) {
      setNotice('No rooms selected.');
      return;
    }
    setDeleteError(null);
    setIsConfirmVisible(true);
  };

  const showContextMenu = (room: Room, event: GestureResponderEvent) => {
    if (deleteMode) return;
    longPressHandledRef.current = true;

    const menuWidth = 112;
    const menuHeight = 46;
    const minimumLeft = 12;
    const maximumLeft = Math.max(minimumLeft, windowWidth - menuWidth - 12);
    const minimumTop = insets.top + 64;
    const maximumTop = Math.max(
      minimumTop,
      windowHeight - Math.max(insets.bottom, 16) - 104 - menuHeight,
    );
    const proposedLeft = event.nativeEvent.pageX - menuWidth / 2;
    const proposedTop = event.nativeEvent.pageY + 10;

    setContextMenu({
      room,
      left: Math.min(Math.max(proposedLeft, minimumLeft), maximumLeft),
      top:
        proposedTop <= maximumTop
          ? Math.max(proposedTop, minimumTop)
          : Math.max(event.nativeEvent.pageY - menuHeight - 10, minimumTop),
    });
  };

  const handleCardPress = (room: Room) => {
    if (deleteMode) {
      toggleRoomSelection(room.id);
      return;
    }
    if (longPressHandledRef.current) {
      longPressHandledRef.current = false;
      return;
    }
    router.push(`/bh/${id}/room/${room.id}`);
  };
  const {
    getHouseById,
    isLoading: isLoadingHouses,
    loadError: housesError,
    reload: reloadHouses,
  } = useBoardingHouses();
  const house = getHouseById(id as string);
  const {
    getRoomsForHouse,
    isLoading: isLoadingRooms,
    loadError: roomsError,
    reload: reloadRooms,
  } = useRooms();

  const confirmDeletion = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const selectedCount = selectedRoomIds.size;
      const { data, error } = await getSupabaseClient().rpc('delete_rooms_with_tenant_archive', {
        p_boarding_house_id: id,
        p_room_ids: [...selectedRoomIds],
      });
      if (error) throw error;
      if (data !== selectedCount) throw new Error('The selected rooms were not all deleted.');
      setIsConfirmVisible(false);
      setDeleteMode(false);
      setSelectedRoomIds(new Set());
      reloadRooms();
      setNotice(`${selectedCount} ${selectedCount === 1 ? 'room' : 'rooms'} deleted.`);
    } catch (error: unknown) {
      setDeleteError(getDeleteErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  if (!house) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        {isLoadingHouses ? (
          <ActivityIndicator color="#2563EB" size="large" />
        ) : (
          <>
            <Text style={styles.emptyText}>{housesError ?? `Boarding house "${id}" not found.`}</Text>
            {housesError && (
              <Pressable onPress={reloadHouses} style={styles.retryButton}>
                <Text style={styles.retryLabel}>Try again</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    );
  }

  const rooms = getRoomsForHouse(id as string);
  const occupiedCount = rooms.filter((room) => room.status === 'occupied').length;

  if (isLoadingRooms || roomsError) {
    return (
      <View style={[styles.container, styles.centered]}>
        {isLoadingRooms ? (
          <ActivityIndicator color="#2563EB" size="large" />
        ) : (
          <>
            <Text style={styles.emptyText}>{roomsError}</Text>
            <Pressable onPress={reloadRooms} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: `${house.name} Rooms`,
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={deleteMode ? 'Cancel room deletion' : 'Delete rooms'}
            accessibilityState={{ selected: deleteMode }}
            disabled={isDeleting}
            onPress={() => {
              if (deleteMode) cancelDeleteMode();
              else {
                setContextMenu(null);
                setDeleteMode(true);
              }
            }}
            style={styles.headerAction}
          >
            <Ionicons name="trash-outline" size={22} color={deleteMode ? '#DC2626' : '#64748B'} />
          </Pressable>
        ),
      }} />

      {rooms.length === 0 ? (
        <Text style={styles.emptyText}>
          No rooms registered yet for {house.name}.
          {!deleteMode && <>{'\n'}Tap the + button to add one.</>}
        </Text>
      ) : (
        <FlatList
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={styles.houseAddress}>{house.address}</Text>
              <Text style={styles.houseSummary}>
                {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} · {occupiedCount} occupied
              </Text>
            </View>
          }
          data={rooms}
          keyExtractor={(room) => room.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const selected = selectedRoomIds.has(item.id);
            const checkbox = (
              <Ionicons
                color={selected ? '#2563EB' : '#64748B'}
                name={selected ? 'checkbox' : 'square-outline'}
                size={22}
              />
            );
            if (!isOccupied(item)) {
              return (
                <Pressable
                  delayLongPress={650}
                  onLongPress={deleteMode ? undefined : (event) => showContextMenu(item, event)}
                  onPressIn={() => {
                    longPressHandledRef.current = false;
                  }}
                  onPress={() => handleCardPress(item)}
                  style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={deleteMode ? `${selected ? 'Deselect' : 'Select'} ${item.roomName}` : `Open ${item.roomName}, currently vacant`}
                  accessibilityState={deleteMode ? { selected } : undefined}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.roomTitle}>{item.roomName}</Text>
                    <StatusBadge occupied={false} />
                  </View>
                  {deleteMode ? (
                    <View style={styles.tenantRow}>
                      <Text style={styles.cardLine}>{formatPeso(item.monthlyRate)} / month</Text>
                      {checkbox}
                    </View>
                  ) : (
                    <>
                      <Text style={styles.cardLine}>{formatPeso(item.monthlyRate)} / month</Text>
                      <Text style={styles.cta}>Tap to view room details</Text>
                    </>
                  )}
                </Pressable>
              );
            }

            const { tenant } = item;

            return (
              <Pressable
                delayLongPress={650}
                onLongPress={deleteMode ? undefined : (event) => showContextMenu(item, event)}
                onPressIn={() => {
                  longPressHandledRef.current = false;
                }}
                onPress={() => handleCardPress(item)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                accessibilityRole="button"
                accessibilityLabel={deleteMode ? `${selected ? 'Deselect' : 'Select'} ${item.roomName}` : `Open ${item.roomName}, ${tenant.firstName} ${tenant.lastName}`}
                accessibilityState={deleteMode ? { selected } : undefined}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.roomTitle}>{item.roomName}</Text>
                  <StatusBadge occupied />
                </View>

                <View style={styles.tenantRow}>
                  <Text style={styles.tenantName}>
                    {tenant.firstName} {tenant.lastName}
                  </Text>
                  {deleteMode ? checkbox : <Ionicons name="chevron-forward" size={22} color="#8A94A6" />}
                </View>

                <Text style={styles.cardLine}>{formatPeso(item.monthlyRate)} / month</Text>
              </Pressable>
            );
          }}
        />
      )}

      <AnimatedFAB
        backgroundColor={deleteMode ? '#DC2626' : undefined}
        icon={deleteMode ? <Ionicons color="#FFFFFF" name="trash-outline" size={23} /> : undefined}
        onPress={deleteMode ? requestDeletion : () => router.push(`/bh/${id}/room/new`)}
        accessibilityLabel={deleteMode ? 'Delete selected rooms' : 'Register a new room'}
      />
      {notice && (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}
      <Modal
        animationType="fade"
        onRequestClose={() => setContextMenu(null)}
        statusBarTranslucent
        transparent
        visible={contextMenu !== null}>
        <View style={styles.contextMenuOverlay}>
          <Pressable
            accessibilityLabel="Dismiss edit menu"
            accessibilityRole="button"
            onPress={() => setContextMenu(null)}
            style={StyleSheet.absoluteFill}
          />
          {contextMenu && (
            <Pressable
              accessibilityLabel={`Edit ${contextMenu.room.roomName}`}
              accessibilityRole="menuitem"
              onPress={() => {
                setEditingRoom(contextMenu.room);
                setContextMenu(null);
              }}
              style={({ pressed }) => [
                styles.contextMenu,
                { left: contextMenu.left, top: contextMenu.top },
                pressed && styles.contextMenuPressed,
              ]}>
              <Ionicons color="#2563EB" name="create-outline" size={19} />
              <Text style={styles.contextMenuLabel}>Edit</Text>
            </Pressable>
          )}
        </View>
      </Modal>
      {editingRoom && (
        <RoomEditModal
          room={editingRoom}
          onCancel={() => setEditingRoom(null)}
          onSaved={(room) => {
            setEditingRoom(null);
            setContextMenu(null);
            setNotice(`${room.roomName} updated.`);
          }}
        />
      )}
      <Modal
        animationType="fade"
        transparent
        visible={isConfirmVisible}
        onRequestClose={() => { if (!isDeleting) setIsConfirmVisible(false); }}
      >
        <View style={styles.dialogBackdrop}>
          <View accessibilityRole="alert" style={styles.dialog}>
            <Text style={styles.dialogTitle}>Delete rooms?</Text>
            <Text style={styles.dialogBody}>
              {selectedRoomIds.size} {selectedRoomIds.size === 1 ? 'room' : 'rooms'} selected.
              {'\n\n'}
              Each selected room and its custom charges will be permanently deleted and cannot
              be recovered. Any active or scheduled tenants in those rooms will be archived.
              Their ID and signed agreement photos will be kept in the archive.
            </Text>
            {deleteError && <Text accessibilityLiveRegion="polite" style={styles.dialogError}>{deleteError}</Text>}
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" disabled={isDeleting}
                onPress={() => setIsConfirmVisible(false)}
                style={({ pressed }) => [styles.cancelButton, pressed && !isDeleting && styles.dialogButtonPressed]}>
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={isDeleting}
                onPress={() => void confirmDeletion()}
                style={({ pressed }) => [styles.deleteButton, pressed && !isDeleting && styles.dialogButtonPressed, isDeleting && styles.deleteButtonDisabled]}>
                <Text style={styles.deleteLabel}>{isDeleting ? 'Deleting…' : 'Delete'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StatusBadge({ occupied }: { occupied: boolean }) {
  return (
    <View style={[styles.badge, occupied ? styles.badgeOccupied : styles.badgeVacant]}>
      <Text style={[styles.badgeText, occupied ? styles.badgeTextOccupied : styles.badgeTextVacant]}>
        {occupied ? 'Occupied' : 'Vacant'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  emptyText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingHorizontal: 40,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  retryButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
  },
  retryLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 110, // keeps the last card clear of the FAB
    gap: 12,
  },
  header: {
    marginBottom: 4,
    gap: 2,
  },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  houseAddress: {
    fontSize: 14,
    color: '#6B7280',
  },
  houseSummary: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A2B3C',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roomTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A2B3C',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeVacant: { backgroundColor: '#F2F4F7' },
  badgeOccupied: { backgroundColor: '#DBEAFE' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeTextVacant: { color: '#475467' },
  badgeTextOccupied: { color: '#1D4ED8' },
  tenantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tenantName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1A2B3C',
  },
  cardLine: {
    fontSize: 14,
    color: '#555',
  },
  cta: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
  notice: {
    position: 'absolute', left: 24, right: 24, bottom: 104,
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 12, backgroundColor: '#1F2937', elevation: 5,
  },
  noticeText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  contextMenuOverlay: {
    flex: 1,
  },
  contextMenu: {
    position: 'absolute',
    width: 112,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 7,
    elevation: 6,
  },
  contextMenuPressed: {
    backgroundColor: '#EFF6FF',
  },
  contextMenuLabel: {
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '700',
  },
  dialogBackdrop: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  dialog: { width: '100%', maxWidth: 420, gap: 14, padding: 22, borderRadius: 18, backgroundColor: '#FFFFFF' },
  dialogTitle: { color: '#1E3A8A', fontSize: 20, fontWeight: '700' },
  dialogBody: { color: '#475569', fontSize: 14, lineHeight: 21 },
  dialogError: { color: '#B42318', fontSize: 13 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  cancelButton: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 18,
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, backgroundColor: '#FFFFFF',
  },
  cancelLabel: { color: '#475569', fontSize: 14, fontWeight: '700' },
  deleteButton: {
    minHeight: 44, minWidth: 92, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#DC2626',
  },
  deleteButtonDisabled: { opacity: 0.65 },
  deleteLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  dialogButtonPressed: { opacity: 0.8 },
});