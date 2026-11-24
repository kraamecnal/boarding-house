import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

import { formatPeso, formatShortDate, todayIso } from '@/utils/billing';
import { dateFromLocalIso, isValidIsoDate, toLocalIsoDate } from '@/utils/meterReadings';
import { getSupabaseClient } from '@/utils/supabase';

type ElectricityOption = 'reading' | 'no_charge';

export type MoveOutInput = {
  tenancyId: string;
  moveOutDate: string;
  electricityOption: ElectricityOption;
  readingValue: number | null;
  readingAt: string | null;
};

type MoveOutPreview = {
  earliestMoveOutDate: string;
  moveOutDate: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  electricityOption: ElectricityOption | null;
  readingValue: number | null;
  readingAt: string | null;
  units: number | null;
  electricityCharge: number;
  total: number;
  noElectricityCharge: boolean;
};

type Props = {
  visible: boolean;
  tenancyId: string;
  tenantName: string;
  onClose: () => void;
  onConfirm: (input: MoveOutInput) => Promise<void>;
};

function sanitizeReadingInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length === 0 ? whole : `${whole}.${rest.join('').slice(0, 3)}`;
}

function parseReading(text: string): number | null {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : null;
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

export default function MoveOutModal({
  visible,
  tenancyId,
  tenantName,
  onClose,
  onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const [moveOutDate, setMoveOutDate] = useState(todayIso());
  const [earliestDate, setEarliestDate] = useState<string | null>(null);
  const [option, setOption] = useState<ElectricityOption | null>(null);
  const [readingValue, setReadingValue] = useState('');
  const [readingAt, setReadingAt] = useState(todayIso());
  const [datePicker, setDatePicker] = useState<'moveOut' | 'reading' | null>(null);
  const [preview, setPreview] = useState<MoveOutPreview | null>(null);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [isLoadingLimits, setIsLoadingLimits] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadLimits = useCallback(async () => {
    if (!visible || !tenancyId) return;
    setIsLoadingLimits(true);
    setFormError(null);
    try {
      const today = todayIso();
      const { data, error } = await getSupabaseClient().rpc('preview_tenant_move_out', {
        p_tenancy_id: tenancyId,
        p_move_out_date: today,
        p_electricity_option: null,
        p_reading_value: null,
        p_reading_at: null,
      });
      if (error) throw error;
      const result = data as MoveOutPreview;
      setEarliestDate(result.earliestMoveOutDate);
    } catch (error: unknown) {
      setFormError(errorMessage(error, 'Could not load the move-out date limits.'));
    } finally {
      setIsLoadingLimits(false);
    }
  }, [tenancyId, visible]);

  useEffect(() => {
    if (!visible) return;
    const timeout = setTimeout(() => void loadLimits(), 0);
    return () => clearTimeout(timeout);
  }, [loadLimits, visible]);

  const today = todayIso();
  const busy = isLoadingLimits || isPreviewing || isConfirming;

  const selectMoveOutDate = (date: string) => {
    setMoveOutDate(date);
    if (readingAt < date) setReadingAt(date);
    setPreview(null);
    setFormError(null);
  };

  const review = async () => {
    if (!option) {
      setFormError('Choose Enter final meter reading or No electricity charge for this bill.');
      return;
    }
    if (!isValidIsoDate(moveOutDate) || moveOutDate > today) {
      setFormError('Choose a move-out date today or earlier.');
      return;
    }
    if (earliestDate && moveOutDate < earliestDate) {
      setFormError(`Choose a move-out date on or after ${formatShortDate(earliestDate)}.`);
      return;
    }

    const numericReading = option === 'reading' ? parseReading(readingValue) : null;
    if (option === 'reading' && numericReading === null) {
      setFormError('Enter a valid nonnegative final meter reading.');
      return;
    }
    if (
      option === 'reading' &&
      (!isValidIsoDate(readingAt) || readingAt < moveOutDate || readingAt > today)
    ) {
      setFormError('Choose a reading date from the move-out date through today.');
      return;
    }

    setIsPreviewing(true);
    setFormError(null);
    try {
      const { data, error } = await getSupabaseClient().rpc('preview_tenant_move_out', {
        p_tenancy_id: tenancyId,
        p_move_out_date: moveOutDate,
        p_electricity_option: option,
        p_reading_value: numericReading,
        p_reading_at: option === 'reading' ? readingAt : null,
      });
      if (error) throw error;
      setPreview(data as MoveOutPreview);
      setStep('confirm');
    } catch (error: unknown) {
      setFormError(errorMessage(error, 'Could not prepare this move-out.'));
    } finally {
      setIsPreviewing(false);
    }
  };

  const confirm = async () => {
    if (!preview || !option || isConfirming) return;
    setIsConfirming(true);
    setFormError(null);
    try {
      await onConfirm({
        tenancyId,
        moveOutDate,
        electricityOption: option,
        readingValue: option === 'reading' ? parseReading(readingValue) : null,
        readingAt: option === 'reading' ? readingAt : null,
      });
    } catch (error: unknown) {
      setFormError(errorMessage(error, 'Could not archive this tenant. Please try again.'));
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
      transparent
      visible={visible}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.handle} />
          <View style={styles.headingRow}>
            <View style={styles.headingCopy}>
              <Text style={styles.title}>
                {step === 'form' ? 'Move-out details' : 'Confirm move-out'}
              </Text>
              <Text style={styles.subtitle}>{tenantName}</Text>
            </View>
            <Pressable
              accessibilityLabel="Close move-out form"
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={styles.closeButton}>
              <Ionicons color="#475467" name="close" size={22} />
            </Pressable>
          </View>

          {step === 'form' ? (
            <ScrollView
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Move-out date</Text>
              {Platform.OS === 'web' ? (
                <TextInput
                  accessibilityLabel="Move-out date"
                  editable={!busy}
                  onChangeText={selectMoveOutDate}
                  placeholder="YYYY-MM-DD"
                  style={styles.input}
                  value={moveOutDate}
                />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => setDatePicker('moveOut')}
                  style={styles.dateField}>
                  <Text style={styles.dateValue}>{formatShortDate(moveOutDate)}</Text>
                  <Ionicons color="#2563EB" name="calendar-outline" size={20} />
                </Pressable>
              )}
              {earliestDate && (
                <Text style={styles.helper}>
                  Earliest allowed date: {formatShortDate(earliestDate)}
                </Text>
              )}

              <Text style={[styles.label, styles.choiceLabel]}>Final electricity choice</Text>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: option === 'reading' }}
                disabled={busy}
                onPress={() => {
                  setOption('reading');
                  setFormError(null);
                }}
                style={[styles.choice, option === 'reading' && styles.choiceSelected]}>
                <Radio selected={option === 'reading'} />
                <Text style={styles.choiceText}>Enter final meter reading</Text>
              </Pressable>

              {option === 'reading' && (
                <View style={styles.readingFields}>
                  <Text style={styles.label}>Final meter reading (kWh)</Text>
                  <TextInput
                    accessibilityLabel="Final meter reading in kilowatt-hours"
                    editable={!busy}
                    keyboardType="decimal-pad"
                    onChangeText={(value) => {
                      setReadingValue(sanitizeReadingInput(value));
                      setFormError(null);
                    }}
                    placeholder="Enter final meter reading"
                    placeholderTextColor="#98A2B3"
                    style={styles.input}
                    value={readingValue}
                  />
                  <Text style={styles.label}>Reading date</Text>
                  {Platform.OS === 'web' ? (
                    <TextInput
                      accessibilityLabel="Reading date"
                      editable={!busy}
                      onChangeText={setReadingAt}
                      placeholder="YYYY-MM-DD"
                      style={styles.input}
                      value={readingAt}
                    />
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => setDatePicker('reading')}
                      style={styles.dateField}>
                      <Text style={styles.dateValue}>{formatShortDate(readingAt)}</Text>
                      <Ionicons color="#2563EB" name="calendar-outline" size={20} />
                    </Pressable>
                  )}
                </View>
              )}

              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: option === 'no_charge' }}
                disabled={busy}
                onPress={() => {
                  setOption('no_charge');
                  setFormError(null);
                }}
                style={[styles.choice, option === 'no_charge' && styles.choiceSelected]}>
                <Radio selected={option === 'no_charge'} />
                <Text style={styles.choiceText}>No electricity charge for this bill</Text>
              </Pressable>

              {option === 'no_charge' && (
                <View style={styles.warningCard}>
                  <Ionicons color="#B54708" name="warning-outline" size={20} />
                  <Text style={styles.warningText}>
                    This final bill will show Electricity not charged. This cannot be undone.
                  </Text>
                </View>
              )}

              {isLoadingLimits && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#2563EB" size="small" />
                  <Text style={styles.loadingText}>Checking move-out dates…</Text>
                </View>
              )}
              {formError && (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  {formError}
                </Text>
              )}

              <Pressable
                accessibilityRole="button"
                disabled={busy || !earliestDate}
                onPress={() => void review()}
                style={[
                  styles.primaryButton,
                  (busy || !earliestDate) && styles.buttonDisabled,
                ]}>
                {isPreviewing ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.primaryLabel}>Review move-out</Text>
                )}
              </Pressable>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.form}>
              {preview && (
                <>
                  <Text style={styles.confirmCopy}>
                    Confirm the final bill for {tenantName}. Archiving cannot be undone.
                  </Text>
                  <SummaryRow label="Move-out date" value={formatShortDate(preview.moveOutDate)} />
                  <SummaryRow
                    label="Billing period"
                    value={`${formatShortDate(preview.periodStart)} – ${formatShortDate(preview.periodEnd)}`}
                  />
                  <SummaryRow label="Due date" value={formatShortDate(preview.dueDate)} />
                  {option === 'reading' && (
                    <>
                      <SummaryRow
                        label="Final meter reading"
                        value={`${preview.readingValue?.toLocaleString()} kWh`}
                      />
                      <SummaryRow
                        label="Reading date"
                        value={preview.readingAt ? formatShortDate(preview.readingAt) : ''}
                      />
                      <SummaryRow
                        label="Units"
                        value={`${preview.units?.toLocaleString() ?? '0'} kWh`}
                      />
                      <SummaryRow
                        label="Electricity charge"
                        value={formatPeso(preview.electricityCharge)}
                      />
                    </>
                  )}
                  {option === 'no_charge' && (
                    <>
                      <View style={styles.warningCard}>
                        <Ionicons color="#B54708" name="warning-outline" size={20} />
                        <Text style={styles.warningText}>
                          Electricity not charged. Total without electricity:{' '}
                          {formatPeso(preview.total)}. This cannot be undone.
                        </Text>
                      </View>
                      <SummaryRow label="Electricity charge" value="Electricity not charged" />
                    </>
                  )}
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalValue}>{formatPeso(preview.total)}</Text>
                  </View>
                </>
              )}
              {formError && (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  {formError}
                </Text>
              )}
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => {
                    setStep('form');
                    setFormError(null);
                  }}
                  style={[styles.secondaryButton, busy && styles.buttonDisabled]}>
                  <Text style={styles.secondaryLabel}>Back</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void confirm()}
                  style={[styles.dangerButton, busy && styles.buttonDisabled]}>
                  {isConfirming ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.primaryLabel}>Confirm move-out</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          )}

          {datePicker && (
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              maximumDate={dateFromLocalIso(today)}
              minimumDate={dateFromLocalIso(
                datePicker === 'moveOut'
                  ? earliestDate && earliestDate < today
                    ? earliestDate
                    : today
                  : moveOutDate,
              )}
              mode="date"
              onChange={(_event, selected) => {
                setDatePicker(null);
                if (!selected) return;
                const iso = toLocalIsoDate(selected);
                if (datePicker === 'moveOut') {
                  selectMoveOutDate(iso);
                } else {
                  setReadingAt(iso);
                  setFormError(null);
                }
              }}
              value={dateFromLocalIso(
                datePicker === 'moveOut'
                  ? moveOutDate
                  : readingAt && isValidIsoDate(readingAt)
                    ? readingAt
                    : today,
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function Radio({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.radio, selected && styles.radioSelected]}>
      {selected && <View style={styles.radioDot} />}
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.52)',
  },
  sheet: {
    maxHeight: '94%',
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  handle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    marginBottom: 10,
    borderRadius: 2,
    backgroundColor: '#D0D5DD',
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  headingCopy: { flex: 1 },
  title: { color: '#1A2B3C', fontSize: 21, fontWeight: '700' },
  subtitle: { marginTop: 3, color: '#667085', fontSize: 14 },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#F2F4F7',
  },
  form: { gap: 12, paddingBottom: 8 },
  label: { color: '#344054', fontSize: 14, fontWeight: '600' },
  choiceLabel: { marginTop: 6 },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    color: '#1A2B3C',
    fontSize: 15,
    backgroundColor: '#FFFFFF',
  },
  dateField: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
  },
  dateValue: { color: '#1A2B3C', fontSize: 15 },
  helper: { color: '#667085', fontSize: 12 },
  choice: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  choiceSelected: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  choiceText: { flex: 1, color: '#1A2B3C', fontSize: 14, fontWeight: '600' },
  radio: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#98A2B3',
    borderRadius: 10,
  },
  radioSelected: { borderColor: '#2563EB' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2563EB' },
  readingFields: { gap: 10, padding: 14, borderRadius: 12, backgroundColor: '#F8FAFC' },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#FFFAEB',
  },
  warningText: { flex: 1, color: '#7A2E0E', fontSize: 13, lineHeight: 18 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingText: { color: '#667085', fontSize: 13 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    borderRadius: 10,
    backgroundColor: '#2563EB',
  },
  primaryLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.55 },
  confirmCopy: { color: '#475467', fontSize: 14, lineHeight: 20 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E7EC',
  },
  summaryLabel: { flex: 1, color: '#667085', fontSize: 14 },
  summaryValue: {
    flex: 1,
    color: '#1A2B3C',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1A2B3C',
  },
  totalLabel: { color: '#1A2B3C', fontSize: 16, fontWeight: '700' },
  totalValue: { color: '#1E3A8A', fontSize: 18, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  secondaryButton: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  secondaryLabel: { color: '#344054', fontSize: 15, fontWeight: '700' },
  dangerButton: {
    minHeight: 48,
    flex: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#B42318',
  },
});
