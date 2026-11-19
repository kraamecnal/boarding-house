import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AnimatedFAB from '@/components/AnimatedFAB';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useRooms } from '@/contexts/RoomsContext';
import { getSupabaseClient } from '@/utils/supabase';

function getDeleteErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return 'Could not delete the selected boarding houses.';
}

export default function BoardingHousesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { boardingHouses, isLoading, loadError, reload: reloadHouses } = useBoardingHouses();
  const { getRoomsForHouse, loadError: roomsError, reload: reloadRooms } = useRooms();
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedHouseIds, setSelectedHouseIds] = useState<Set<string>>(() => new Set());
  const [isConfirmVisible, setIsConfirmVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleDeleteMode = () => {
    if (isDeleting) return;
    setDeleteMode((current) => !current);
    setSelectedHouseIds(new Set());
    setIsConfirmVisible(false);
    setDeleteError(null);
  };

  const toggleHouseSelection = (houseId: string) => {
    setSelectedHouseIds((current) => {
      const next = new Set(current);
      if (next.has(houseId)) next.delete(houseId);
      else next.add(houseId);
      return next;
    });
  };

  const requestDeletion = () => {
    if (selectedHouseIds.size === 0) {
      setNotice('No boarding houses selected.');
      return;
    }
    setDeleteError(null);
    setIsConfirmVisible(true);
  };

  const confirmDeletion = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const selectedCount = selectedHouseIds.size;
      const { data, error } = await getSupabaseClient().rpc('delete_boarding_houses', {
        p_boarding_house_ids: [...selectedHouseIds],
      });
      if (error) throw error;
      if (data !== selectedCount) {
        throw new Error('The selected boarding houses were not all deleted. Please try again.');
      }

      setIsConfirmVisible(false);
      setDeleteMode(false);
      setSelectedHouseIds(new Set());
      reloadHouses();
      reloadRooms();
      setNotice(`${selectedCount} boarding ${selectedCount === 1 ? 'house' : 'houses'} deleted.`);
    } catch (error: unknown) {
      setDeleteError(getDeleteErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={boardingHouses}
        keyExtractor={(house) => house.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 8 },
        ]}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View style={styles.listHeaderRow}>
              <Text style={styles.title}>Boarding houses</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  deleteMode ? 'Cancel boarding house deletion' : 'Delete boarding houses'
                }
                accessibilityState={{ selected: deleteMode }}
                disabled={isDeleting}
                onPress={toggleDeleteMode}
                style={styles.headerAction}>
                <Ionicons
                  color={deleteMode ? '#DC2626' : '#64748B'}
                  name="trash-outline"
                  size={22}
                />
              </Pressable>
            </View>
            {roomsError && <Text style={styles.loadError}>{roomsError}</Text>}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color="#2563EB" size="large" />
            </View>
          ) : loadError ? (
            <View style={styles.emptyState}>
              <Text accessibilityLiveRegion="polite" style={styles.loadError}>{loadError}</Text>
              <Pressable accessibilityRole="button" onPress={reloadHouses} style={styles.emptyAction}>
                <Text style={styles.emptyActionLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No boarding houses yet.</Text>
              <Text style={styles.emptyDescription}>
                Add your first boarding house to get started.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/register-house')}
                style={({ pressed }) => [
                  styles.emptyAction,
                  pressed && styles.emptyActionPressed,
                ]}
              >
                <Text style={styles.emptyActionLabel}>Add boarding house</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item }) => {
          const houseRooms = getRoomsForHouse(item.id);
          const roomCount = houseRooms.length;
          const occupiedCount = houseRooms.filter((room) => room.status === 'occupied').length;
          const selected = selectedHouseIds.has(item.id);
          return (
            <Pressable
              onPress={() => {
                if (deleteMode) toggleHouseSelection(item.id);
                else router.push(`/bh/${item.id}`);
              }}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              accessibilityRole="button"
              accessibilityLabel={
                deleteMode
                  ? `${selected ? 'Deselect' : 'Select'} ${item.name}`
                  : `Open ${item.name}, ${item.address}, ${roomCount} ${
                      roomCount === 1 ? 'room' : 'rooms'
                    }, ${occupiedCount} occupied`
              }
              accessibilityState={deleteMode ? { selected } : undefined}
            >
              <View style={styles.cardText}>
                <Text style={styles.houseName}>{item.name}</Text>
                <Text style={styles.address}>{item.address}</Text>
                <Text style={styles.tenants}>
                  {roomCount} {roomCount === 1 ? 'room' : 'rooms'} · {occupiedCount} occupied
                </Text>
              </View>
              {deleteMode ? (
                <Ionicons
                  color={selected ? '#2563EB' : '#64748B'}
                  name={selected ? 'checkbox' : 'square-outline'}
                  size={22}
                />
              ) : (
                <Ionicons name="chevron-forward" size={22} color="#8A94A6" />
              )}
            </Pressable>
          );
        }}
      />

      <AnimatedFAB
        backgroundColor={deleteMode ? '#DC2626' : undefined}
        icon={
          deleteMode ? <Ionicons color="#FFFFFF" name="trash-outline" size={23} /> : undefined
        }
        onPress={deleteMode ? requestDeletion : () => router.push('/register-house')}
        accessibilityLabel={
          deleteMode ? 'Delete selected boarding houses' : 'Register a new boarding house'
        }
      />

      {notice && (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      <Modal
        animationType="fade"
        transparent
        visible={isConfirmVisible}
        onRequestClose={() => {
          if (!isDeleting) setIsConfirmVisible(false);
        }}>
        <View style={styles.dialogBackdrop}>
          <View accessibilityRole="alert" style={styles.dialog}>
            <Text style={styles.dialogTitle}>Delete boarding houses?</Text>
            <Text style={styles.dialogBody}>
              {selectedHouseIds.size}{' '}
              {selectedHouseIds.size === 1 ? 'boarding house' : 'boarding houses'} selected.
              {'\n\n'}
              For each selected boarding house, all rooms and any custom charges set for those
              rooms will be permanently deleted and cannot be recovered. All tenants will be
              archived and their tenancies ended. Their ID and signed-agreement photos will be kept.
            </Text>
            {deleteError && (
              <Text accessibilityLiveRegion="polite" style={styles.dialogError}>
                {deleteError}
              </Text>
            )}
            <View style={styles.dialogActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isDeleting}
                onPress={() => setIsConfirmVisible(false)}
                style={({ pressed }) => [
                  styles.cancelButton,
                  pressed && !isDeleting && styles.dialogButtonPressed,
                ]}>
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isDeleting}
                onPress={() => void confirmDeletion()}
                style={({ pressed }) => [
                  styles.deleteButton,
                  pressed && !isDeleting && styles.dialogButtonPressed,
                  isDeleting && styles.deleteButtonDisabled,
                ]}>
                <Text style={styles.deleteLabel}>{isDeleting ? 'Deleting…' : 'Delete'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 110,
    gap: 12,
    flexGrow: 1,
  },
  listHeader: {
    gap: 6,
  },
  listHeaderRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#1E3A8A',
    fontSize: 26,
    fontWeight: '700',
  },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  emptyTitle: {
    color: '#1E3A8A',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyDescription: {
    marginTop: 6,
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  loadError: {
    color: '#B42318',
    fontSize: 13,
    textAlign: 'center',
  },
  emptyAction: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 18,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
  },
  emptyActionPressed: {
    opacity: 0.75,
  },
  emptyActionLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  cardPressed: {
    opacity: 0.8,
  },
  cardText: {
    flex: 1,
    gap: 3,
    paddingRight: 12,
  },
  houseName: {
    color: '#1E3A8A',
    fontSize: 18,
    fontWeight: '700',
  },
  address: {
    color: '#64748B',
    fontSize: 14,
  },
  tenants: {
    marginTop: 3,
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  notice: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 104,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1F2937',
    elevation: 5,
  },
  noticeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  dialogBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    gap: 14,
    padding: 22,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
  },
  dialogTitle: {
    color: '#1E3A8A',
    fontSize: 20,
    fontWeight: '700',
  },
  dialogBody: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 21,
  },
  dialogError: {
    color: '#B42318',
    fontSize: 13,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  cancelButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  cancelLabel: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteButton: {
    minHeight: 44,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#DC2626',
  },
  deleteButtonDisabled: {
    opacity: 0.65,
  },
  deleteLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  dialogButtonPressed: {
    opacity: 0.8,
  },
});
