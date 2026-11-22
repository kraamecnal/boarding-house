import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { isOccupied, useRooms } from '@/contexts/RoomsContext';
import {
  buildBillText,
  computeTotals,
  currentPeriod,
  periodLabel,
  shiftPeriod,
  todayIso,
} from '@/utils/billing';
import {
  billMeterErrorMessage,
  cancelBillElectricityRollForward,
  carryForwardBillElectricity,
  getBillMeterContext,
  saveBillMeterReading,
  type BillMeterContext,
} from '@/utils/meterBilling';
import {
  billDeliveryMessage,
  finalizeAndSendBill,
  resendFinalBill,
  type BillDeliveryResult,
} from '@/utils/billDelivery';
import {
  isValidIsoDate,
  parseMeterReadingInput,
  sanitizeMeterReadingInput,
} from '@/utils/meterReadings';

export default function TenantBillScreen() {
  const params = useLocalSearchParams<{ roomId: string; period?: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const requestedPeriod = Array.isArray(params.period) ? params.period[0] : params.period;

  const {
    getRoomById,
    isLoading: isLoadingRooms,
    loadError: roomsError,
  } = useRooms();
  const { getBill, setStatus, isLoading: isLoadingBills, loadError, reload } = useBills();
  const { getHouseById } = useBoardingHouses();
  const { hasPaymentPassword } = useAuth();
  const router = useRouter();
  const room = roomId ? getRoomById(roomId) : undefined;
  const boardingHouseName = room ? getHouseById(room.boardingHouseId)?.name ?? '' : '';
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
  const [meterContext, setMeterContext] = useState<BillMeterContext | null>(null);
  const [isLoadingMeterContext, setIsLoadingMeterContext] = useState(false);
  const [meterContextError, setMeterContextError] = useState<string | null>(null);
  const [meterReadingValue, setMeterReadingValue] = useState('');
  const [isSavingMeterReading, setIsSavingMeterReading] = useState(false);
  const [meterContextAttempt, setMeterContextAttempt] = useState(0);
  const [isLateReadingMode, setIsLateReadingMode] = useState(false);
  const [lateReadingDate, setLateReadingDate] = useState<string | null>(null);
  const [isCarryingForward, setIsCarryingForward] = useState(false);
  const [isCancellingCarryForward, setIsCancellingCarryForward] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [deliveryResult, setDeliveryResult] = useState<BillDeliveryResult | null>(null);
  const deliveryInFlight = useRef(false);

  useEffect(() => {
    let isCurrent = true;
    if (!record?.billId) {
      setMeterContext(null);
      setMeterContextError(null);
      setIsLoadingMeterContext(false);
      return () => {
        isCurrent = false;
      };
    }

    const readingAt = isLateReadingMode
      ? lateReadingDate && isValidIsoDate(lateReadingDate)
        ? lateReadingDate
        : null
      : todayIso();
    if (!readingAt) {
      setMeterContext(null);
      setMeterContextError(null);
      setIsLoadingMeterContext(false);
      setMeterReadingValue('');
      return () => {
        isCurrent = false;
      };
    }

    setIsLoadingMeterContext(true);
    setMeterContextError(null);
    setMeterContext(null);
    void getBillMeterContext(record.billId, readingAt)
      .then((context) => {
        if (!isCurrent) return;
        setMeterContext(context);
        setMeterReadingValue(
          context.currentReading ? String(context.currentReading.value) : '',
        );
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setMeterContext(null);
        setMeterContextError(
          error instanceof Error ? error.message : 'Could not load meter details.',
        );
      })
      .finally(() => {
        if (isCurrent) setIsLoadingMeterContext(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [isLateReadingMode, lateReadingDate, meterContextAttempt, period, record?.billId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

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

  const handleSaveMeterReading = async () => {
    if (!record.billId || isSavingMeterReading) return;
    const readingAt = isLateReadingMode
      ? lateReadingDate
      : meterContext?.currentReading?.readingAt ?? todayIso();
    if (!readingAt) {
      Alert.alert('Choose a reading date', 'Select the actual date the meter was read.');
      return;
    }
    if (
      isLateReadingMode &&
      (!isValidIsoDate(readingAt) ||
        !meterContext?.readingDateValid)
    ) {
      Alert.alert(
        'Choose a valid reading date',
        'The actual reading date must be within this bill period and during the tenancy.',
      );
      return;
    }
    const value = parseMeterReadingInput(meterReadingValue);
    if (value === null) {
      Alert.alert('Invalid reading', 'Enter a valid nonnegative meter reading.');
      return;
    }

    setIsSavingMeterReading(true);
    try {
      await saveBillMeterReading(
        record.billId,
        value,
        readingAt,
      );
      setIsLateReadingMode(false);
      setLateReadingDate(null);
      setMeterContextAttempt((attempt) => attempt + 1);
      reload();
    } catch (error: unknown) {
      Alert.alert(
        'Could not save meter reading',
        billMeterErrorMessage(error, 'Please try again.'),
      );
    } finally {
      setIsSavingMeterReading(false);
    }
  };

  const handleCarryForward = async () => {
    if (!record.billId || isCarryingForward) return;
    setIsCarryingForward(true);
    try {
      await carryForwardBillElectricity(record.billId);
      reload();
    } catch (error: unknown) {
      Alert.alert(
        'Could not carry usage forward',
        billMeterErrorMessage(error, 'Please try again.'),
      );
    } finally {
      setIsCarryingForward(false);
    }
  };

  const confirmCarryForward = () => {
    Alert.alert(
      'Carry missed electricity usage forward?',
      'The next bill with a meter reading will include all usage since the last saved reading, charged at that bill’s current rate. No reading will be invented, and this bill cannot be marked paid until the next reading is recorded.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Carry Forward', onPress: () => void handleCarryForward() },
      ],
    );
  };

  const handleCancelCarryForward = () => {
    const billId = record.billId;
    if (!billId || isCancellingCarryForward) return;
    Alert.alert(
      'Cancel carry-forward?',
      'This can only be cancelled before a later meter reading is recorded.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel Carry-Forward',
          style: 'destructive',
          onPress: () => {
            setIsCancellingCarryForward(true);
            void cancelBillElectricityRollForward(billId)
              .then(reload)
              .catch((error: unknown) => {
                Alert.alert(
                  'Could not cancel carry-forward',
                  billMeterErrorMessage(error, 'Please try again.'),
                );
              })
              .finally(() => setIsCancellingCarryForward(false));
          },
        },
      ],
    );
  };

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
    const fallback = computeTotals(room.monthlyRate, record.electricity);
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
      const sharedTotal = record.billId
        ? record.totalAmount
        : computeTotals(room.monthlyRate, record.electricity).total;
      await Share.share({
        message: buildBillText({
          room,
          boardingHouseName,
          period: record.period,
          issuedDate: record.issuedDate,
          dueDate: record.dueDate,
          electricity: record.electricity,
          status: record.status,
          items: record.items,
          totalAmount: sharedTotal,
        }),
      });
    } catch {
      Alert.alert('Could not share', 'Something went wrong while sharing this bill.');
    }
  };

  const handleFinalizeDelivery = async () => {
    if (!record.billId || deliveryInFlight.current) return;
    deliveryInFlight.current = true;
    setIsFinalizing(true);
    setDeliveryResult(null);
    try {
      const result = await finalizeAndSendBill(record.billId);
      setDeliveryResult(result);
      reload();
      Alert.alert('Bill finalized', billDeliveryMessage(result));
    } catch (error: unknown) {
      Alert.alert(
        'Could not finalize bill',
        error instanceof Error ? error.message : 'Please review the bill and try again.',
      );
    } finally {
      deliveryInFlight.current = false;
      setIsFinalizing(false);
    }
  };

  const confirmFinalizeDelivery = () => {
    if (!record.billId || record.isFinalized) return;
    const recipient = room.tenant.email.trim() || 'No email on file';
    Alert.alert(
      'Finalize & send this bill?',
      `Recipient: ${recipient}\nTotal: PHP ${record.totalAmount.toFixed(2)}\n\nAfter finalization, bill items cannot be changed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finalize & Send',
          onPress: () => void handleFinalizeDelivery(),
        },
      ],
    );
  };

  const handleResend = async () => {
    if (!record.billId || deliveryInFlight.current) return;
    deliveryInFlight.current = true;
    setIsResending(true);
    setDeliveryResult(null);
    try {
      const result = await resendFinalBill(record.billId);
      setDeliveryResult(result);
      Alert.alert('Bill resend result', billDeliveryMessage(result));
    } catch (error: unknown) {
      Alert.alert(
        'Could not resend bill',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      deliveryInFlight.current = false;
      setIsResending(false);
    }
  };

  const confirmResend = () => {
    if (!record.billId || !record.isFinalized) return;
    const recipient = room.tenant.email.trim() || 'No email on file';
    Alert.alert(
      'Resend final bill?',
      `Recipient: ${recipient}\nTotal: PHP ${record.totalAmount.toFixed(2)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Resend', onPress: () => void handleResend() },
      ],
    );
  };

  const hasElectricityCharge = record.items.some(
    (item) =>
      item.itemType === 'electricity' ||
      (item.itemType === 'adjustment' && item.description === 'Electricity'),
  );
  const canFinalize =
    Boolean(record.billId) &&
    !record.isFinalized &&
    record.status !== 'paid' &&
    (hasElectricityCharge || Boolean(record.electricityRollForwardToBillId));

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
            onPress={() => {
              setIsLateReadingMode(false);
              setLateReadingDate(null);
              setPeriod(shiftPeriod(period, -1));
              reload();
            }}
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
            onPress={() => {
              setIsLateReadingMode(false);
              setLateReadingDate(null);
              setPeriod(shiftPeriod(period, 1));
              reload();
            }}
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

        <BillStatement
          room={room}
          boardingHouseName={boardingHouseName}
          record={record}
          meterContext={meterContext}
          meterContextLoading={isLoadingMeterContext}
          meterContextError={meterContextError}
          meterReadingValue={meterReadingValue}
          isSavingMeterReading={isSavingMeterReading}
          isLateReadingMode={isLateReadingMode}
          lateReadingDate={lateReadingDate}
          isCarryingForward={isCarryingForward}
          isCancellingCarryForward={isCancellingCarryForward}
          onChangeMeterReading={(text) => setMeterReadingValue(sanitizeMeterReadingInput(text))}
          onSelectLateReadingDate={setLateReadingDate}
          onStartLateReading={() => {
            setLateReadingDate(null);
            setMeterReadingValue('');
            setIsLateReadingMode(true);
          }}
          onCancelLateReading={() => {
            setIsLateReadingMode(false);
            setLateReadingDate(null);
          }}
          onCarryForward={confirmCarryForward}
          onCancelCarryForward={handleCancelCarryForward}
          onSaveMeterReading={() => void handleSaveMeterReading()}
          onChangeStatus={handleChangeStatus}
        />

        {!record.isFinalized && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canFinalize || isFinalizing }}
            disabled={!canFinalize || isFinalizing}
            onPress={confirmFinalizeDelivery}
            style={[
              styles.primaryDeliveryButton,
              (!canFinalize || isFinalizing) && styles.deliveryButtonDisabled,
            ]}>
            <Ionicons name="mail-outline" size={18} color="#FFFFFF" />
            <Text style={styles.primaryDeliveryLabel}>
              {isFinalizing ? 'Finalizing…' : 'Finalize & send'}
            </Text>
          </Pressable>
        )}

        {record.isFinalized && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isResending }}
            disabled={isResending}
            onPress={confirmResend}
            style={[
              styles.secondaryDeliveryButton,
              isResending && styles.deliveryButtonDisabled,
            ]}>
            <Ionicons name="refresh-outline" size={18} color="#1E3A8A" />
            <Text style={styles.secondaryDeliveryLabel}>
              {isResending ? 'Resending…' : 'Resend final bill'}
            </Text>
          </Pressable>
        )}

        {deliveryResult && (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.deliveryNotice,
              deliveryResult.kind === 'sent'
                ? styles.deliveryNoticeSuccess
                : styles.deliveryNoticeWarning,
            ]}>
            <Text style={styles.deliveryNoticeText}>
              {billDeliveryMessage(deliveryResult)}
            </Text>
          </View>
        )}

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
  primaryDeliveryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    shadowColor: '#1E3A8A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryDeliveryLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryDeliveryButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#EFF6FF',
  },
  secondaryDeliveryLabel: {
    color: '#1E3A8A',
    fontSize: 14,
    fontWeight: '700',
  },
  deliveryButtonDisabled: {
    opacity: 0.55,
  },
  deliveryNotice: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  deliveryNoticeSuccess: {
    borderColor: '#93C5FD',
    backgroundColor: '#DBEAFE',
  },
  deliveryNoticeWarning: {
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  deliveryNoticeText: {
    color: '#1E293B',
    fontSize: 13,
    lineHeight: 19,
  },
});