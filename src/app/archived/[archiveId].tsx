import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBills } from '@/contexts/BillsContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { signedDocumentUrl } from '@/contexts/RoomsContext';
import { formatRoomLabel } from '@/components/RoomLabel';
import {
  billDeliveryMessage,
  finalizeAndSendBill,
  resendFinalBill,
} from '@/utils/billDelivery';
import { formatPeso, formatShortDate, periodLabel } from '@/utils/billing';
import {
  manilaDateFromTimestamp,
  paymentTimestampForDate,
  paymentUpdateErrorMessage,
  todayInManila,
} from '@/utils/billPayments';
import { dateFromLocalIso, isValidIsoDate } from '@/utils/meterReadings';
import { getSupabaseClient } from '@/utils/supabase';

type ArchiveTab = 'info' | 'history';

type ArchiveRow = {
  archive_id: string;
  tenancy_id: string | null;
  tenant_name: string;
  contact_number: string | null;
  email_address: string | null;
  move_in_date: string;
  move_out_date: string;
  room_name: string | null;
  boarding_house_name: string | null;
  boarding_house_address: string | null;
  id_photo_path: string | null;
  agreement_photo_path: string | null;
  archived_at: string;
};

type DbBillItem = {
  bill_item_id: string;
  item_type: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  amount: number | null;
};

type DbBill = {
  bill_id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  billed_at: string | null;
  total_amount: number;
  paid_at: string | null;
  is_paid: boolean | null;
  bill_items: DbBillItem[] | null;
};

type ArchivedBill = {
  id: string;
  period: string;
  periodEnd: string;
  dueDate: string;
  isFinalized: boolean;
  paidDate: string | null;
  isPaid: boolean;
  total: number;
  hasElectricityResult: boolean;
  items: { id: string; label: string; amount: number }[];
};

function itemLabel(item: DbBillItem): string {
  switch (item.item_type) {
    case 'rent':
      return 'Room rent';
    case 'water':
      return 'Water';
    case 'trash':
      return 'Trash';
    case 'wifi':
      return 'Wifi';
    case 'electricity':
      return 'Electricity';
    default:
      return item.description || 'Adjustment';
  }
}

function mapBill(row: DbBill): ArchivedBill {
  return {
    id: row.bill_id,
    period: row.period_start.slice(0, 7),
    periodEnd: row.period_end,
    dueDate: row.due_date,
    isFinalized: row.billed_at !== null,
    paidDate: manilaDateFromTimestamp(row.paid_at),
    isPaid: row.is_paid === true || row.paid_at !== null,
    total: Number(row.total_amount),
    hasElectricityResult: (row.bill_items ?? []).some(
      (item) =>
        item.item_type === 'electricity' ||
        (item.item_type === 'adjustment' &&
          (item.description === 'Electricity' ||
            item.description === 'Electricity not charged')),
    ),
    items: (row.bill_items ?? []).map((item) => ({
      id: item.bill_item_id,
      label: itemLabel(item),
      amount: Number(item.amount ?? Number(item.quantity) * Number(item.unit_price)),
    })),
  };
}

export default function ArchivedTenantScreen() {
  const params = useLocalSearchParams<{ archiveId: string }>();
  const archiveId = Array.isArray(params.archiveId) ? params.archiveId[0] : params.archiveId;
  const insets = useSafeAreaInsets();
  const { reload: reloadBills } = useBills();
  const { reload: reloadNotifications } = useNotifications();

  const [tab, setTab] = useState<ArchiveTab>('info');
  const [archive, setArchive] = useState<ArchiveRow | null>(null);
  const [bills, setBills] = useState<ArchivedBill[]>([]);
  const [idUri, setIdUri] = useState('');
  const [agreementUri, setAgreementUri] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [paymentBillId, setPaymentBillId] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayInManila());
  const [showPaymentDatePicker, setShowPaymentDatePicker] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [deliveryBillId, setDeliveryBillId] = useState<string | null>(null);
  const paymentInFlight = useRef(false);
  const deliveryInFlight = useRef(false);

  useEffect(() => {
    let isCurrent = true;

    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        if (!archiveId) throw new Error('This archived tenant could not be found.');
        const client = getSupabaseClient();
        const { data, error } = await client
          .from('tenant_archive')
          .select(
            'archive_id, tenancy_id, tenant_name, contact_number, email_address, move_in_date, move_out_date, room_name, boarding_house_name, boarding_house_address, id_photo_path, agreement_photo_path, archived_at',
          )
          .eq('archive_id', archiveId)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('This archived tenant could not be found.');
        const row = data as ArchiveRow;

        let billRows: DbBill[] = [];
        if (row.tenancy_id) {
          const { data: billData, error: billError } = await client
            .from('monthly_bill')
            .select(
              'bill_id, period_start, period_end, due_date, billed_at, total_amount, paid_at, is_paid, bill_items(bill_item_id,item_type,description,quantity,unit_price,amount)',
            )
            .eq('tenancy_id', row.tenancy_id)
            .order('period_start', { ascending: false });
          if (billError) throw billError;
          billRows = (billData ?? []) as DbBill[];
        }

        const [nextIdUri, nextAgreementUri] = await Promise.all([
          signedDocumentUrl(row.id_photo_path).catch(() => ''),
          signedDocumentUrl(row.agreement_photo_path).catch(() => ''),
        ]);

        if (!isCurrent) return;
        setArchive(row);
        setBills(billRows.map(mapBill));
        setIdUri(nextIdUri);
        setAgreementUri(nextAgreementUri);
      } catch (error: unknown) {
        if (isCurrent) {
          setLoadError(
            error instanceof Error ? error.message : 'Could not load this archived tenant.',
          );
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    void load();
    return () => {
      isCurrent = false;
    };
  }, [archiveId, loadAttempt]);

  const paymentBill = bills.find((bill) => bill.id === paymentBillId) ?? null;

  const openPaymentModal = (bill: ArchivedBill) => {
    if (bill.isPaid || paymentInFlight.current) return;
    setPaymentBillId(bill.id);
    setPaymentDate(todayInManila());
    setPaymentError(null);
    setShowPaymentDatePicker(false);
  };

  const closePaymentModal = () => {
    if (paymentInFlight.current) return;
    setPaymentBillId(null);
    setPaymentError(null);
    setShowPaymentDatePicker(false);
  };

  const updateLocalBillAsPaid = (billId: string, paidAt: string, isPaid: boolean) => {
    setBills((current) =>
      current.map((bill) =>
        bill.id === billId
          ? { ...bill, paidDate: manilaDateFromTimestamp(paidAt), isPaid }
          : bill,
      ),
    );
  };

  const deliverBill = async (bill: ArchivedBill, action: 'finalize' | 'resend') => {
    if (deliveryInFlight.current) return;
    deliveryInFlight.current = true;
    setDeliveryBillId(bill.id);
    try {
      const result =
        action === 'finalize'
          ? await finalizeAndSendBill(bill.id)
          : await resendFinalBill(bill.id);
      setLoadAttempt((attempt) => attempt + 1);
      reloadBills();
      reloadNotifications();
      Alert.alert(
        action === 'finalize' ? 'Bill finalized' : 'Bill resend result',
        billDeliveryMessage(result),
      );
    } catch (error: unknown) {
      Alert.alert(
        action === 'finalize' ? 'Could not finalize bill' : 'Could not resend bill',
        errorMessage(error, 'Please try again.'),
      );
    } finally {
      deliveryInFlight.current = false;
      setDeliveryBillId(null);
    }
  };

  const confirmFinalize = (bill: ArchivedBill) => {
    if (!archive || bill.isFinalized || bill.isPaid || !bill.hasElectricityResult) return;
    Alert.alert(
      'Finalize & send this bill?',
      `Recipient: ${archive.email_address?.trim() || 'No email on file'}\nTotal: PHP ${bill.total.toFixed(2)}\n\nAfter finalization, bill items cannot be changed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Finalize & Send', onPress: () => void deliverBill(bill, 'finalize') },
      ],
    );
  };

  const confirmResend = (bill: ArchivedBill) => {
    if (!archive || !bill.isFinalized) return;
    Alert.alert(
      'Resend final bill?',
      `Recipient: ${archive.email_address?.trim() || 'No email on file'}\nTotal: PHP ${bill.total.toFixed(2)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Resend', onPress: () => void deliverBill(bill, 'resend') },
      ],
    );
  };

  const recordPayment = async () => {
    if (!paymentBill || paymentInFlight.current) return;

    const today = todayInManila();
    if (
      !isValidIsoDate(paymentDate) ||
      !archive ||
      paymentDate < archive.move_in_date ||
      paymentDate > today
    ) {
      setPaymentError('Choose a payment date from the move-in date through today.');
      return;
    }
    if (paymentBill.isPaid) {
      setPaymentError('This bill is already paid. Its original payment date cannot be changed.');
      return;
    }

    paymentInFlight.current = true;
    setIsSavingPayment(true);
    setPaymentError(null);

    try {
      const client = getSupabaseClient();
      const paidAt = paymentTimestampForDate(paymentDate);
      const { data, error } = await client
        .from('monthly_bill')
        .update({ paid_at: paidAt })
        .eq('bill_id', paymentBill.id)
        .is('paid_at', null)
        .or('is_paid.eq.false,is_paid.is.null')
        .select('bill_id, paid_at, is_paid')
        .maybeSingle();

      if (error) throw error;
      if (data) {
        updateLocalBillAsPaid(data.bill_id, data.paid_at, data.is_paid === true);
        setPaymentBillId(null);
        reloadBills();
        reloadNotifications();
        return;
      }

      const { data: currentBill, error: readError } = await client
        .from('monthly_bill')
        .select('bill_id, paid_at, is_paid')
        .eq('bill_id', paymentBill.id)
        .maybeSingle();
      if (readError) throw readError;

      if (
        currentBill &&
        (currentBill.is_paid === true || currentBill.paid_at !== null)
      ) {
        if (currentBill.paid_at) {
          updateLocalBillAsPaid(
            currentBill.bill_id,
            currentBill.paid_at,
            true,
          );
        }
        setPaymentBillId(null);
        reloadBills();
        reloadNotifications();
        Alert.alert(
          'Bill already paid',
          'This bill was paid elsewhere. Its original payment date was preserved.',
        );
        return;
      }

      setPaymentError(
        'This bill could not be updated. It may not be available to your account anymore.',
      );
    } catch (error: unknown) {
      setPaymentError(paymentUpdateErrorMessage(error));
    } finally {
      paymentInFlight.current = false;
      setIsSavingPayment(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Archived tenant' }} />
        <ActivityIndicator color="#2563EB" size="large" />
      </View>
    );
  }

  if (loadError || !archive) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Archived tenant' }} />
        <Text style={styles.emptyText}>{loadError ?? 'This archived tenant could not be found.'}</Text>
        <Pressable onPress={() => setLoadAttempt((attempt) => attempt + 1)} style={styles.retryButton}>
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: archive.tenant_name }} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <Ionicons name="archive-outline" size={18} color="#475467" />
          <Text style={styles.bannerText}>
            Archived · read-only · moved out {formatShortDate(archive.move_out_date)}
          </Text>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          <SectionTab
            label="Tenant's Information"
            selected={tab === 'info'}
            onPress={() => setTab('info')}
          />
          <SectionTab label="History" selected={tab === 'history'} onPress={() => setTab('history')} />
        </View>

        {tab === 'info' ? (
          <>
            <View style={styles.card}>
              <InfoRow
                label="Room"
                value={formatRoomLabel(archive.room_name, archive.boarding_house_name) || '—'}
              />
              <InfoRow label="Tenant" value={archive.tenant_name} />
              <InfoRow label="Email" value={archive.email_address || '—'} />
              <InfoRow label="Contact" value={archive.contact_number || '—'} />
              <InfoRow label="Moved in" value={formatShortDate(archive.move_in_date)} />
              <InfoRow label="Moved out" value={formatShortDate(archive.move_out_date)} />
              <InfoRow label="Archived on" value={formatShortDate(archive.archived_at.slice(0, 10))} />
            </View>
            <PhotoCard label="Valid ID" uri={idUri} onPress={setViewerUri} />
            <PhotoCard label="Contract" uri={agreementUri} onPress={setViewerUri} />
          </>
        ) : bills.length === 0 ? (
          <Text style={styles.emptyText}>No bills were recorded for this tenant.</Text>
        ) : (
          bills.map((bill) => {
            const expanded = expandedBillId === bill.id;
            return (
              <View key={bill.id} style={styles.historyCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${periodLabel(bill.period)} bill, ${bill.isPaid ? 'paid' : 'unpaid'}`}
                  onPress={() => setExpandedBillId(expanded ? null : bill.id)}
                  style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}>
                  <View style={styles.historyCopy}>
                    <Text style={styles.historyTitle}>{periodLabel(bill.period)} bill</Text>
                    <Text style={bill.isPaid ? styles.paidText : styles.unpaidText}>
                      {bill.isPaid && bill.paidDate
                        ? `Paid on ${formatShortDate(bill.paidDate)}`
                        : bill.isPaid
                          ? 'Paid'
                          : `Unpaid · due ${formatShortDate(bill.dueDate)}`}
                    </Text>
                  </View>
                  <Text style={styles.historyAmount}>{formatPeso(bill.total)}</Text>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color="#8A94A6"
                  />
                </Pressable>

                {expanded && (
                  <View style={styles.breakdown}>
                    {bill.items.length === 0 ? (
                      <Text style={styles.breakdownEmpty}>No itemized charges were recorded.</Text>
                    ) : (
                      bill.items.map((item) => (
                        <View key={item.id} style={styles.breakdownRow}>
                          <Text style={styles.breakdownLabel}>{item.label}</Text>
                          <Text style={styles.breakdownAmount}>{formatPeso(item.amount)}</Text>
                        </View>
                      ))
                    )}
                    <View style={[styles.breakdownRow, styles.breakdownTotal]}>
                      <Text style={styles.breakdownTotalLabel}>Total</Text>
                      <Text style={styles.breakdownTotalAmount}>{formatPeso(bill.total)}</Text>
                    </View>
                    <Text style={styles.breakdownMeta}>
                      Due {formatShortDate(bill.dueDate)}
                      {bill.paidDate ? ` · Paid ${formatShortDate(bill.paidDate)}` : ''}
                    </Text>
                    {!bill.isFinalized && !bill.isPaid && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled:
                            deliveryBillId === bill.id || !bill.hasElectricityResult,
                        }}
                        disabled={deliveryBillId === bill.id || !bill.hasElectricityResult}
                        onPress={() => confirmFinalize(bill)}
                        style={[
                          styles.deliveryButton,
                          (deliveryBillId === bill.id || !bill.hasElectricityResult) &&
                            styles.deliveryButtonDisabled,
                        ]}>
                        {deliveryBillId === bill.id ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <>
                            <Ionicons name="mail-outline" size={18} color="#FFFFFF" />
                            <Text style={styles.deliveryLabel}>Finalize & send</Text>
                          </>
                        )}
                      </Pressable>
                    )}
                    {bill.isFinalized && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: deliveryBillId === bill.id }}
                        disabled={deliveryBillId === bill.id}
                        onPress={() => confirmResend(bill)}
                        style={[
                          styles.resendButton,
                          deliveryBillId === bill.id && styles.deliveryButtonDisabled,
                        ]}>
                        {deliveryBillId === bill.id ? (
                          <ActivityIndicator color="#1E3A8A" size="small" />
                        ) : (
                          <>
                            <Ionicons name="refresh-outline" size={18} color="#1E3A8A" />
                            <Text style={styles.resendLabel}>Resend final bill</Text>
                          </>
                        )}
                      </Pressable>
                    )}
                    {!bill.isPaid && (
                      <Pressable
                        accessibilityRole="button"
                        disabled={isSavingPayment}
                        onPress={() => openPaymentModal(bill)}
                        style={({ pressed }) => [
                          styles.recordPaymentButton,
                          pressed && styles.recordPaymentButtonPressed,
                          isSavingPayment && styles.recordPaymentButtonDisabled,
                        ]}>
                        <Ionicons name="card-outline" size={18} color="#FFFFFF" />
                        <Text style={styles.recordPaymentLabel}>Record Payment</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={viewerUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewerUri(null)}>
          {viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImage} />}
          <View style={[styles.viewerClose, { top: insets.top + 12 }]}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={paymentBill !== null}
        transparent
        animationType="slide"
        onRequestClose={closePaymentModal}>
        <View style={styles.paymentOverlay}>
          <View style={[styles.paymentSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.paymentTitle}>Record Payment</Text>

            {paymentBill && (
              <>
                <View style={styles.paymentSummary}>
                  <View>
                    <Text style={styles.paymentBillLabel}>
                      {periodLabel(paymentBill.period)} bill
                    </Text>
                    <Text style={styles.paymentAmountLabel}>Total amount</Text>
                  </View>
                  <Text style={styles.paymentAmount}>{formatPeso(paymentBill.total)}</Text>
                </View>

                <Text style={styles.paymentDateLabel}>Payment date</Text>
                {Platform.OS === 'web' ? (
                  <TextInput
                    accessibilityLabel="Payment date"
                    editable={!isSavingPayment}
                    maxLength={10}
                    onChangeText={setPaymentDate}
                    placeholder="YYYY-MM-DD"
                    style={styles.paymentDateInput}
                    value={paymentDate}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={isSavingPayment}
                    onPress={() => setShowPaymentDatePicker((visible) => !visible)}
                    style={styles.paymentDateField}>
                    <Text style={styles.paymentDateValue}>{formatShortDate(paymentDate)}</Text>
                    <Ionicons name="calendar-outline" size={20} color="#2563EB" />
                  </Pressable>
                )}

                {Platform.OS === 'android' && showPaymentDatePicker && archive && (
                  <DateTimePicker
                    value={dateFromLocalIso(
                      isValidIsoDate(paymentDate) ? paymentDate : todayInManila(),
                    )}
                    mode="date"
                    display="default"
                    minimumDate={dateFromLocalIso(archive.move_in_date)}
                    maximumDate={dateFromLocalIso(todayInManila())}
                    onValueChange={(_event, selected) => {
                      setShowPaymentDatePicker(false);
                      if (selected) {
                        const selectedDate = [
                          selected.getFullYear(),
                          String(selected.getMonth() + 1).padStart(2, '0'),
                          String(selected.getDate()).padStart(2, '0'),
                        ].join('-');
                        setPaymentDate(selectedDate);
                        setPaymentError(null);
                      }
                    }}
                    onDismiss={() => setShowPaymentDatePicker(false)}
                  />
                )}

                {Platform.OS === 'ios' && showPaymentDatePicker && archive && (
                  <DateTimePicker
                    value={dateFromLocalIso(
                      isValidIsoDate(paymentDate) ? paymentDate : todayInManila(),
                    )}
                    mode="date"
                    display="inline"
                    minimumDate={dateFromLocalIso(archive.move_in_date)}
                    maximumDate={dateFromLocalIso(todayInManila())}
                    onValueChange={(_event, selected) => {
                      if (selected) {
                        const selectedDate = [
                          selected.getFullYear(),
                          String(selected.getMonth() + 1).padStart(2, '0'),
                          String(selected.getDate()).padStart(2, '0'),
                        ].join('-');
                        setPaymentDate(selectedDate);
                        setPaymentError(null);
                      }
                    }}
                  />
                )}
              </>
            )}

            {paymentError && (
              <Text accessibilityLiveRegion="polite" style={styles.paymentError}>
                {paymentError}
              </Text>
            )}

            <View style={styles.paymentActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isSavingPayment}
                onPress={closePaymentModal}
                style={[
                  styles.paymentCancelButton,
                  isSavingPayment && styles.paymentButtonDisabled,
                ]}>
                <Text style={styles.paymentCancelLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isSavingPayment}
                onPress={() => void recordPayment()}
                style={[
                  styles.paymentConfirmButton,
                  isSavingPayment && styles.paymentButtonDisabled,
                ]}>
                {isSavingPayment ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.paymentConfirmLabel}>Mark as Paid</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SectionTab({
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
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.selectedTab]}>
      <Text style={[styles.tabLabel, selected && styles.selectedTabLabel]}>{label}</Text>
    </Pressable>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return fallback;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function PhotoCard({
  label,
  uri,
  onPress,
}: {
  label: string;
  uri: string;
  onPress: (uri: string) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.photoLabel}>{label}</Text>
      {uri ? (
        <>
          <Pressable
            onPress={() => onPress(uri)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`View ${label} photo`}>
            <Image source={{ uri }} style={styles.photo} />
          </Pressable>
          <Text style={styles.photoHint}>Tap to view full size</Text>
        </>
      ) : (
        <View style={[styles.photo, styles.photoUnavailable]}>
          <Text style={styles.photoHint}>Document unavailable</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
    backgroundColor: '#f8f9fa',
  },
  content: { padding: 16, paddingBottom: 48, gap: 12, flexGrow: 1 },
  emptyText: {
    marginTop: 40,
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
  },
  retryLabel: { color: '#2563EB', fontSize: 14, fontWeight: '600' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F2F4F7',
  },
  bannerText: { flex: 1, color: '#475467', fontSize: 13, fontWeight: '600' },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: 10,
    backgroundColor: '#E4E7EC',
  },
  tab: {
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  selectedTab: { backgroundColor: '#FFFFFF' },
  tabLabel: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  selectedTabLabel: { color: '#1A2B3C' },
  card: {
    padding: 16,
    gap: 10,
    borderRadius: 12,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  infoRow: { flexDirection: 'row', gap: 12 },
  infoLabel: { width: 110, color: '#6B7280', fontSize: 14 },
  infoValue: { flex: 1, color: '#1A2B3C', fontSize: 14, fontWeight: '600' },
  photoLabel: { color: '#1A2B3C', fontSize: 14, fontWeight: '700' },
  photo: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    backgroundColor: '#F7F8FA',
    resizeMode: 'cover',
  },
  photoUnavailable: { alignItems: 'center', justifyContent: 'center' },
  photoHint: { color: '#6B7280', fontSize: 12 },
  historyCard: {
    borderRadius: 12,
    backgroundColor: 'white',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  pressed: { opacity: 0.85 },
  historyCopy: { flex: 1, gap: 2 },
  historyTitle: { color: '#1A2B3C', fontSize: 16, fontWeight: '700' },
  paidText: { color: '#067647', fontSize: 13, fontWeight: '600' },
  unpaidText: { color: '#B42318', fontSize: 13, fontWeight: '600' },
  historyAmount: { color: '#1A2B3C', fontSize: 15, fontWeight: '700' },
  breakdown: {
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E4E7EC',
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  breakdownLabel: { flex: 1, color: '#475467', fontSize: 14 },
  breakdownAmount: { color: '#1A2B3C', fontSize: 14, fontWeight: '600' },
  breakdownTotal: { paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E4E7EC' },
  breakdownTotalLabel: { color: '#1A2B3C', fontSize: 15, fontWeight: '700' },
  breakdownTotalAmount: { color: '#1A2B3C', fontSize: 15, fontWeight: '700' },
  breakdownEmpty: { color: '#6B7280', fontSize: 13 },
  breakdownMeta: { color: '#6B7280', fontSize: 12 },
  recordPaymentButton: {
    minHeight: 44,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    backgroundColor: '#2563EB',
  },
  recordPaymentButtonPressed: { backgroundColor: '#1D4ED8' },
  recordPaymentButtonDisabled: { opacity: 0.6 },
  recordPaymentLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  deliveryButton: {
    minHeight: 44,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    backgroundColor: '#1E3A8A',
  },
  deliveryLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  resendButton: {
    minHeight: 44,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#B9C5F2',
    borderRadius: 10,
    backgroundColor: '#EFF4FF',
  },
  resendLabel: { color: '#1E3A8A', fontSize: 14, fontWeight: '700' },
  deliveryButtonDisabled: { opacity: 0.6 },
  viewer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  viewerImage: { width: '100%', height: '100%', resizeMode: 'contain' },
  viewerClose: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  paymentOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.52)',
  },
  paymentSheet: {
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  sheetHandle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    borderRadius: 2,
    backgroundColor: '#D0D5DD',
  },
  paymentTitle: { color: '#1A2B3C', fontSize: 20, fontWeight: '700' },
  paymentSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
  },
  paymentBillLabel: { color: '#1A2B3C', fontSize: 14, fontWeight: '700' },
  paymentAmountLabel: { marginTop: 3, color: '#667085', fontSize: 12 },
  paymentAmount: { color: '#1A2B3C', fontSize: 18, fontWeight: '700' },
  paymentDateLabel: { color: '#344054', fontSize: 14, fontWeight: '600' },
  paymentDateField: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
  },
  paymentDateInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    color: '#1A2B3C',
    fontSize: 15,
  },
  paymentDateValue: { color: '#1A2B3C', fontSize: 15 },
  paymentError: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  paymentActions: { flexDirection: 'row', gap: 10 },
  paymentCancelButton: {
    minHeight: 46,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  paymentCancelLabel: { color: '#344054', fontSize: 14, fontWeight: '700' },
  paymentConfirmButton: {
    minHeight: 46,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#2563EB',
  },
  paymentConfirmLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  paymentButtonDisabled: { opacity: 0.6 },
});