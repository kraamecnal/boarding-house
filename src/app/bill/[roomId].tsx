import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import BillStatement from '@/components/BillStatement';
import PasswordPromptModal from '@/components/PasswordPromptModal';
import { useAuth } from '@/contexts/AuthContext';
import { useBills, type BillStatus } from '@/contexts/BillsContext';
import { isOccupied, useRooms } from '@/contexts/RoomsContext';
import {
  buildBillText,
  computeTotals,
  currentPeriod,
  periodLabel,
  shiftPeriod,
} from '@/utils/billing';

export default function TenantBillScreen() {
  const params = useLocalSearchParams<{ roomId: string; period?: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const requestedPeriod = Array.isArray(params.period) ? params.period[0] : params.period;

  const {
    getRoomById,
    isLoading: isLoadingRooms,
    loadError: roomsError,
  } = useRooms();
  const { getBill, setElectricity, setStatus, isLoading: isLoadingBills, loadError, reload } = useBills();
  const { hasPaymentPassword } = useAuth();
  const router = useRouter();
  const room = roomId ? getRoomById(roomId) : undefined;
  const [electricityDraft, setElectricityDraft] = useState('');
  const [passwordPromptVisible, setPasswordPromptVisible] = useState(false);

  const minPeriod = room && isOccupied(room) ? room.tenant.startDate.slice(0, 7) : currentPeriod();
  const thisMonth = currentPeriod();
  const maxPeriod = thisMonth >= minPeriod ? thisMonth : minPeriod;

  const initialPeriod =
    requestedPeriod && requestedPeriod >= minPeriod && requestedPeriod <= maxPeriod
      ? requestedPeriod
      : maxPeriod;
  const [period, setPeriod] = useState(initialPeriod);
  const record = room ? getBill(room.id, period) : null;

  useEffect(() => {
    setElectricityDraft(record?.electricity ?? '');
  }, [period, record?.electricity, room?.id]);

  if (!room || !isOccupied(room)) {
    return (
      <View style={[styles.container, styles.centered]}>
        {isLoadingRooms ? (
          <ActivityIndicator color="#2563EB" size="large" />
        ) : (
          <Text style={styles.emptyText}>
            {roomsError ?? (room ? 'This room has no tenant yet.' : 'Tenant not found.')}
          </Text>
        )}
      </View>
    );
  }

  if (isLoadingBills) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#2563EB" size="large" />
      </View>
    );
  }
  if (loadError) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyText}>{loadError}</Text>
        <Pressable onPress={reload} style={styles.retryButton}>
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (!record) return null;

  const canGoBack = period > minPeriod;
  const canGoForward = period < maxPeriod;

  // Marking a bill PAID needs the payment password (set in Profile); UNPAID does not.
  const handleChangeStatus = (status: BillStatus) => {
    if (status === 'paid') {
      if (record.status === 'paid') return;
      if (!hasPaymentPassword) {
        Alert.alert(
          'Set a payment password first',
          'Marking a bill as paid needs a payment password. You can set one in your Profile.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Profile', onPress: () => router.push('/profile') },
          ],
        );
        return;
      }
      setPasswordPromptVisible(true);
      return;
    }
    void setStatus(room.id, period, status).catch((error: unknown) => {
      Alert.alert(
        'Could not update bill',
        error instanceof Error ? error.message : 'Please try again.',
      );
    });
  };

  const handlePasswordVerified = async () => {
    setPasswordPromptVisible(false);
    const rentAmount = record.items
      .filter((item) => item.itemType === 'rent')
      .reduce((sum, item) => sum + item.amount, 0);
    const electricityAmount = record.items
      .filter(
        (item) =>
          item.itemType === 'electricity' ||
          (item.itemType === 'adjustment' && item.description === 'Electricity'),
      )
      .reduce((sum, item) => sum + item.amount, 0);
    const fallback = computeTotals(room.monthlyRate, electricityDraft);
    try {
      await setStatus(room.id, period, 'paid', {
        roomRent: record.billId ? rentAmount : fallback.roomRent,
        electricity: record.billId ? electricityAmount : fallback.electricity,
        total: record.billId ? record.totalAmount : fallback.total,
      });
    } catch (error: unknown) {
      Alert.alert(
        'Could not update bill',
        error instanceof Error ? error.message : 'Please try again.',
      );
    }
  };

  const handleShare = async () => {
    try {
      const manualItem = record.items.find(
        (item) => item.itemType === 'adjustment' && item.description === 'Electricity',
      );
      const sharedItems = record.items.filter((item) => item.id !== manualItem?.id);
      if (electricityDraft.trim() && !record.items.some((item) => item.itemType === 'electricity')) {
        const amount = Number(electricityDraft);
        sharedItems.push({
          id: 'electricity-draft',
          itemType: 'adjustment',
          description: 'Electricity',
          quantity: 1,
          unitPrice: amount,
          amount,
        });
      }
      const sharedTotal = record.billId
        ? record.totalAmount - (manualItem?.amount ?? 0) +
          (electricityDraft.trim() &&
          !record.items.some((item) => item.itemType === 'electricity')
            ? Number(electricityDraft)
            : 0)
        : computeTotals(room.monthlyRate, electricityDraft).total;
      await Share.share({
        message: buildBillText({
          room,
          period: record.period,
          issuedDate: record.issuedDate,
          dueDate: record.dueDate,
          electricity: electricityDraft,
          status: record.status,
          items: sharedItems,
          totalAmount: sharedTotal,
        }),
      });
    } catch {
      Alert.alert('Could not share', 'Something went wrong while sharing this bill.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Month picker */}
        <View style={styles.periodRow}>
          <Pressable
            onPress={() => setPeriod(shiftPeriod(period, -1))}
            disabled={!canGoBack}
            hitSlop={12}
            accessibilityLabel="Previous month"
          >
            <Ionicons
              name="chevron-back"
              size={26}
              color={canGoBack ? '#1A2B3C' : '#D0D5DD'}
            />
          </Pressable>
          <Text style={styles.periodText}>{periodLabel(period)}</Text>
          <Pressable
            onPress={() => setPeriod(shiftPeriod(period, 1))}
            disabled={!canGoForward}
            hitSlop={12}
            accessibilityLabel="Next month"
          >
            <Ionicons
              name="chevron-forward"
              size={26}
              color={canGoForward ? '#1A2B3C' : '#D0D5DD'}
            />
          </Pressable>
        </View>

        <Text style={styles.hint}>
          Type this month's electricity in the Electricity box. The total updates as you type.
        </Text>

        <BillStatement
          room={room}
          record={record}
          electricityValue={electricityDraft}
          onChangeElectricity={setElectricityDraft}
          onCommitElectricity={(text) => {
            void setElectricity(room.id, period, text).catch((error: unknown) => {
              Alert.alert(
                'Could not save electricity',
                error instanceof Error ? error.message : 'Please try again.',
              );
            });
          }}
          onChangeStatus={handleChangeStatus}
        />

        <Pressable style={styles.shareButton} onPress={handleShare}>
          <Ionicons name="share-outline" size={18} color="#007AFF" />
          <Text style={styles.shareText}>Share bill</Text>
        </Pressable>
      </ScrollView>

      {passwordPromptVisible && (
        <PasswordPromptModal
          visible
          onCancel={() => setPasswordPromptVisible(false)}
          onVerified={handlePasswordVerified}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 48,
    backgroundColor: '#f8f9fa',
    gap: 14,
    flexGrow: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
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
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
  },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  periodText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A2B3C',
  },
  hint: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  shareText: {
    color: '#007AFF',
    fontSize: 15,
    fontWeight: '500',
  },
});