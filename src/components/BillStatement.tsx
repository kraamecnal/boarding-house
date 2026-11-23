import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { BillRecord, BillStatus } from '@/contexts/BillsContext';
import type { OccupiedRoom } from '@/contexts/RoomsContext';
import { formatRoomLabel } from '@/components/RoomLabel';
import { FIXED_COSTS_LABEL, PAYMENT_REMINDER } from '@/data/billingConfig';
import {
  computeTotals,
  formatPeso,
  formatShortDate,
  periodLabel,
  todayIso,
} from '@/utils/billing';
import type { BillMeterContext } from '@/utils/meterBilling';
import { dateFromLocalIso, isValidIsoDate, toLocalIsoDate } from '@/utils/meterReadings';

type Props = {
  room: OccupiedRoom;
  record: BillRecord;
  boardingHouseName: string;
  meterContext: BillMeterContext | null;
  meterContextLoading: boolean;
  meterContextError: string | null;
  meterReadingValue: string;
  isSavingMeterReading: boolean;
  isLateReadingMode: boolean;
  lateReadingDate: string | null;
  isCarryingForward: boolean;
  isCancellingCarryForward: boolean;
  canCorrectMeterReading: boolean;
  correctionCheckError: string | null;
  onChangeMeterReading: (text: string) => void;
  onSelectLateReadingDate: (date: string | null) => void;
  onStartLateReading: () => void;
  onCancelLateReading: () => void;
  onCarryForward: () => void;
  onCancelCarryForward: () => void;
  onSaveMeterReading: () => void;
  onCorrectMeterReading: () => void;
  onChangeStatus: (status: BillStatus) => void;
};

export default function BillStatement({
  room,
  record,
  boardingHouseName,
  meterContext,
  meterContextLoading,
  meterContextError,
  meterReadingValue,
  isSavingMeterReading,
  isLateReadingMode,
  lateReadingDate,
  isCarryingForward,
  isCancellingCarryForward,
  canCorrectMeterReading,
  correctionCheckError,
  onChangeMeterReading,
  onSelectLateReadingDate,
  onStartLateReading,
  onCancelLateReading,
  onCarryForward,
  onCancelCarryForward,
  onSaveMeterReading,
  onCorrectMeterReading,
  onChangeStatus,
}: Props) {
  const [showLateReadingDatePicker, setShowLateReadingDatePicker] = useState(false);
  const totals = computeTotals(room.monthlyRate, record.electricity);
  const issuedDateLabel =
    record.issuedDate && record.issuedDate !== 'Not yet issued'
      ? formatShortDate(record.issuedDate)
      : 'Not yet issued';
  const meteredElectricity = record.items.some((item) => item.itemType === 'electricity');
  const manualElectricity = record.items.some(
    (item) => item.itemType === 'adjustment' && item.description === 'Electricity',
  );
  const electricityItem = record.items.find((item) => item.itemType === 'electricity');
  const displayItems = record.items.filter(
    (item) =>
      item.itemType !== 'electricity' &&
      !(item.itemType === 'adjustment' && item.description === 'Electricity'),
  );
  const totalAmount = record.billId ? record.totalAmount : totals.total;
  const canRecordMeterReading =
    Boolean(record.billId) &&
    !record.isFinalized &&
    record.status !== 'paid' &&
    !meteredElectricity &&
    !manualElectricity;
  const today = todayIso();
  const billPeriodEnd = record.periodEnd ?? meterContext?.periodEnd ?? null;
  const billPeriodEnded = billPeriodEnd !== null && today > billPeriodEnd;
  const canResolveMissedReading =
    billPeriodEnded &&
    record.billId !== null &&
    !record.isFinalized &&
    record.status !== 'paid' &&
    !meteredElectricity &&
    !manualElectricity &&
    !record.electricityRollForwardToBillId;
  const billPeriodStart = record.periodStart ?? meterContext?.periodStart ?? null;
  const lateDateMax =
    billPeriodEnd && billPeriodEnd < today ? billPeriodEnd : today;
  const lateDateBoundsValid = Boolean(billPeriodStart && lateDateMax >= billPeriodStart);
  const lateDateSyntaxValid = Boolean(lateReadingDate && isValidIsoDate(lateReadingDate));
  const lateDateSelected = lateDateSyntaxValid && meterContext?.readingDateValid === true;
  const lateDatePickerValue = dateFromLocalIso(
    lateReadingDate && isValidIsoDate(lateReadingDate)
      ? lateReadingDate
      : lateDateMax,
  );

  return (
    <View style={styles.sheet}>
      <DoubleRule />
      <Text style={styles.title}>MONTHLY BILLING STATEMENT</Text>
      <DoubleRule />

      <View style={styles.block}>
        <Field label="Room" value={formatRoomLabel(room.roomName)} />
        <Field label="Tenant Name" value={`${room.tenant.firstName} ${room.tenant.lastName}`} />
        <Field label="Contact" value={room.tenant.contactNumber} />
        <Field label="Email" value={room.tenant.email} />
      </View>

      <Rule />
      <View style={styles.block}>
        <Field label="Billing Period" value={periodLabel(record.period)} />
        <Field label="Bill Date Issued" value={issuedDateLabel} />
        <Field label="Due Date" value={formatShortDate(record.dueDate)} />
      </View>
      <Rule />

      <Text style={styles.sectionTitle}>ITEMIZED BREAKDOWN</Text>
      <Rule />

      <View style={styles.block}>
        {displayItems.length > 0 ? (
          displayItems.map((item) => (
            <Line
              key={item.id}
              label={itemLabel(item.itemType, item.description)}
              value={formatPeso(item.amount)}
            />
          ))
        ) : (
          <>
            <Line label="Room Rent" value={formatPeso(totals.roomRent)} />
            <Text style={styles.text}>Fixed Costs</Text>
            <Line label={`  (${FIXED_COSTS_LABEL})`} value={formatPeso(totals.fixedCosts)} />
            <View style={styles.sumRule} />
            <Line label="Partial Monthly Bill" value={formatPeso(totals.partial)} />
          </>
        )}

        <View style={styles.gap} />

        {manualElectricity && !meteredElectricity ? (
          <Line
            label="Electricity"
            value={formatPeso(
              record.items.find(
                (item) => item.itemType === 'adjustment' && item.description === 'Electricity',
              )?.amount ?? 0,
            )}
          />
        ) : (
          <View style={styles.electricitySection}>
            <Text style={styles.electricityTitle}>Electricity</Text>
            {record.electricityRollForwardFromPeriods.length > 0 && (
              <Text style={styles.rollForwardNotice}>
                This bill includes electricity usage rolled forward from{' '}
                {record.electricityRollForwardFromPeriods.map(periodLabel).join(', ')}.
                The full interval is charged here; usage is not split between periods.
              </Text>
            )}
            {record.electricityRollForwardFromPeriods.length > 0 &&
              meterContext?.previousReading &&
              meterContext.currentReading && (
                <Text style={styles.rollForwardNotice}>
                  Meter interval: {formatShortDate(meterContext.previousReading.readingAt)} to{' '}
                  {formatShortDate(meterContext.currentReading.readingAt)} (
                  {meterContext.previousReading.value.toLocaleString()} to{' '}
                  {meterContext.currentReading.value.toLocaleString()} kWh).
                </Text>
              )}
            {record.electricityRollForwardToBillId ? (
              <View style={styles.rollForwardCard}>
                <Text style={styles.rollForwardNotice}>
                  {record.isFinalized
                    ? `Electricity usage was rolled forward to the ${record.electricityRollForwardToPeriod ? periodLabel(record.electricityRollForwardToPeriod) : 'later'} bill.`
                    : `Carry-forward is pending. The next reading and its electricity charge will be included on the ${record.electricityRollForwardToPeriod ? periodLabel(record.electricityRollForwardToPeriod) : 'later'} bill.`}
                </Text>
                {!record.isFinalized && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={isCancellingCarryForward}
                    onPress={onCancelCarryForward}
                    style={styles.secondaryMeterButton}>
                    <Text style={styles.secondaryMeterButtonLabel}>
                      {isCancellingCarryForward ? 'Cancelling…' : 'Cancel carry-forward'}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : isLateReadingMode ? (
              <View style={styles.lateReadingCard}>
                <Text style={styles.lateReadingDescription}>
                  Enter a reading that was actually taken during this bill period. Do not estimate
                  or backdate a reading you did not take.
                </Text>
                <Text style={styles.readingDateLabel}>Actual reading date</Text>
                {Platform.OS === 'web' ? (
                  <TextInput
                    accessibilityLabel="Actual meter reading date"
                    style={styles.meterInput}
                    value={lateReadingDate ?? ''}
                    onChangeText={(text) => onSelectLateReadingDate(text || null)}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#8A94A6"
                    maxLength={10}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setShowLateReadingDatePicker(true)}
                    style={styles.readingDateField}>
                    <Text style={styles.readingDateText}>
                      {lateReadingDate && isValidIsoDate(lateReadingDate)
                        ? formatShortDate(lateReadingDate)
                        : 'Choose the date the reading was taken'}
                    </Text>
                    <Ionicons name="calendar-outline" size={20} color="#1E3A8A" />
                  </Pressable>
                )}
                {!lateDateBoundsValid && (
                  <Text style={styles.meterError}>
                    No valid historical reading date is available for this bill period.
                  </Text>
                )}
                {Platform.OS === 'android' && showLateReadingDatePicker && lateDateBoundsValid && (
                  <DateTimePicker
                    value={lateDatePickerValue}
                    mode="date"
                    display="default"
                    minimumDate={dateFromLocalIso(billPeriodStart ?? lateDateMax)}
                    maximumDate={dateFromLocalIso(lateDateMax)}
                    onValueChange={(_event, selected) => {
                      setShowLateReadingDatePicker(false);
                      if (selected) onSelectLateReadingDate(toLocalIsoDate(selected));
                    }}
                    onDismiss={() => setShowLateReadingDatePicker(false)}
                  />
                )}
                {Platform.OS === 'ios' && (
                  <Modal
                    visible={showLateReadingDatePicker && lateDateBoundsValid}
                    transparent
                    animationType="slide"
                    onRequestClose={() => setShowLateReadingDatePicker(false)}>
                    <View style={styles.datePickerOverlay}>
                      <View style={styles.datePickerSheet}>
                        {meterContext && lateDateBoundsValid && (
                          <DateTimePicker
                            value={lateDatePickerValue}
                            mode="date"
                            display="inline"
                            minimumDate={dateFromLocalIso(billPeriodStart ?? lateDateMax)}
                            maximumDate={dateFromLocalIso(lateDateMax)}
                            onValueChange={(_event, selected) => {
                              if (selected) onSelectLateReadingDate(toLocalIsoDate(selected));
                            }}
                          />
                        )}
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setShowLateReadingDatePicker(false)}
                          style={styles.datePickerDoneButton}>
                          <Text style={styles.datePickerDoneLabel}>Done</Text>
                        </Pressable>
                      </View>
                    </View>
                  </Modal>
                )}
                {lateReadingDate && !isValidIsoDate(lateReadingDate) && (
                  <Text style={styles.meterError}>Enter a valid reading date.</Text>
                )}
                {lateDateSyntaxValid && meterContextLoading ? (
                  <Text style={styles.electricityMessage}>Checking the reading history…</Text>
                ) : lateDateSyntaxValid && meterContextError ? (
                  <Text style={styles.meterError}>{meterContextError}</Text>
                ) : lateDateSyntaxValid && meterContext && !meterContext.readingDateValid ? (
                  <Text style={styles.meterError}>
                    The selected date must be within this bill period and during the tenancy.
                  </Text>
                ) : lateDateSelected && !meterContext?.previousReading ? (
                  <Text style={styles.meterError}>
                    No earlier meter reading is available for this date.
                  </Text>
                ) : lateDateSelected && meterContext?.previousReading ? (
                  <>
                    <Line
                      label="Previous Reading"
                      value={`${meterContext.previousReading.value.toLocaleString()} kWh`}
                    />
                    {meterContext.currentReading && (
                      <Line
                        label="Reading Already Recorded"
                        value={`${meterContext.currentReading.value.toLocaleString()} kWh`}
                      />
                    )}
                    <TextInput
                      accessibilityLabel="Historical present meter reading in kilowatt-hours"
                      style={styles.meterInput}
                      value={meterReadingValue}
                      onChangeText={onChangeMeterReading}
                      keyboardType="decimal-pad"
                      placeholder="Present reading (kWh)"
                      placeholderTextColor="#8A94A6"
                      editable={!isSavingMeterReading && !meterContext.currentReading}
                    />
                    {meterContext.rate === null ? (
                      <Text style={styles.electricityMessage}>
                        Configure an electricity rate to continue.
                      </Text>
                    ) : (
                      <Line label="Rate per kWh" value={formatPeso(meterContext.rate)} />
                    )}
                    {meterContext.rate !== null && (
                      <Pressable
                        accessibilityRole="button"
                        disabled={isSavingMeterReading}
                        onPress={onSaveMeterReading}
                        style={[
                          styles.meterButton,
                          isSavingMeterReading && styles.meterButtonDisabled,
                        ]}>
                        <Text style={styles.meterButtonLabel}>
                          {isSavingMeterReading
                            ? 'Saving…'
                            : meterContext.currentReading
                              ? 'Use this reading'
                              : 'Save late reading'}
                        </Text>
                      </Pressable>
                    )}
                  </>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={isSavingMeterReading}
                  onPress={onCancelLateReading}
                  style={styles.secondaryMeterButton}>
                  <Text style={styles.secondaryMeterButtonLabel}>Cancel late entry</Text>
                </Pressable>
              </View>
            ) : canResolveMissedReading ? (
              <View style={styles.missedReadingCard}>
                <Text style={styles.missedReadingDescription}>
                  This bill period ended without a reading. If you recorded a reading during that
                  period, enter its actual date and value. Otherwise, carry the usage forward to
                  the next bill with a reading.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={onStartLateReading}
                  style={styles.meterButton}>
                  <Text style={styles.meterButtonLabel}>Enter an actual past reading</Text>
                </Pressable>
                {record.electricityRollForwardAvailable ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={isCarryingForward}
                    onPress={onCarryForward}
                    style={[
                      styles.secondaryMeterButton,
                      isCarryingForward && styles.meterButtonDisabled,
                    ]}>
                    <Text style={styles.secondaryMeterButtonLabel}>
                      {isCarryingForward ? 'Saving…' : 'Carry missed usage forward'}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.electricityMessage}>
                    Carry-forward is unavailable until the billing database is updated.
                  </Text>
                )}
              </View>
            ) : meteredElectricity ? (
              <>
                {electricityItem ? (
                  <Line
                    label="Electricity Charge"
                    value={formatPeso(electricityItem.amount)}
                    bold
                  />
                ) : (
                  <Text style={styles.electricityMessage}>
                    Electricity charge unavailable.
                  </Text>
                )}
                {meterContextLoading ? (
                  <Text style={styles.electricityMessage}>Loading readings…</Text>
                ) : meterContextError ? (
                  <Text accessibilityLiveRegion="polite" style={styles.electricityMessage}>
                    Meter readings unavailable.
                  </Text>
                ) : meterContext?.previousReading && meterContext.currentReading ? (
                  <>
                    <Line
                      label="Previous Reading"
                      value={`${meterContext.previousReading.value.toLocaleString()} kWh`}
                    />
                    <Line
                      label="Present Reading"
                      value={`${meterContext.currentReading.value.toLocaleString()} kWh`}
                    />
                    {canCorrectMeterReading && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={onCorrectMeterReading}
                        style={styles.correctReadingButton}>
                        <Text style={styles.correctReadingLabel}>Correct reading</Text>
                      </Pressable>
                    )}
                    {correctionCheckError && (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ disabled: true }}
                          disabled
                          style={[
                            styles.correctReadingButton,
                            styles.correctReadingButtonDisabled,
                          ]}>
                          <Text style={styles.correctReadingLabel}>Correct reading</Text>
                        </Pressable>
                        <Text style={styles.meterError}>{correctionCheckError}</Text>
                      </>
                    )}
                    <Line
                      label="Electricity Consumed"
                      value={`${(
                        meterContext.currentReading.value - meterContext.previousReading.value
                      ).toLocaleString()} kWh`}
                    />
                    {electricityItem ? (
                      <Line
                        label="Rate per kWh"
                        value={formatPeso(electricityItem.unitPrice)}
                      />
                    ) : (
                      <Text style={styles.electricityMessage}>
                        Configure an electricity rate to continue.
                      </Text>
                    )}
                  </>
                ) : (
                  <>
                    {meterContext?.previousReading ? (
                      <Line
                        label="Previous Reading"
                        value={`${meterContext.previousReading.value.toLocaleString()} kWh`}
                      />
                    ) : null}
                    <Text style={styles.electricityMessage}>
                      {meterContext?.previousReading
                        ? meterContext.currentReading
                          ? 'Electricity details unavailable.'
                          : 'Present reading unavailable.'
                        : 'Meter readings unavailable.'}
                    </Text>
                    {canRecordMeterReading &&
                      meterContext &&
                      meterContext.rate !== null &&
                      meterContext?.previousReading &&
                      meterContext.readingDateValid && (
                        <>
                          {!meterContext.currentReading && (
                            <TextInput
                              accessibilityLabel="Present meter reading in kilowatt-hours"
                              style={styles.meterInput}
                              value={meterReadingValue}
                              onChangeText={onChangeMeterReading}
                              keyboardType="decimal-pad"
                              placeholder="Present reading (kWh)"
                              placeholderTextColor="#8A94A6"
                              editable={!isSavingMeterReading}
                            />
                          )}
                          {meterContext.rate === null ? (
                            <Text style={styles.electricityMessage}>
                              Configure an electricity rate to continue.
                            </Text>
                          ) : (
                            <Line
                              label="Rate per kWh"
                              value={formatPeso(meterContext.rate)}
                            />
                          )}
                          {meterContext.currentReading && electricityItem === undefined && (
                            <Text style={styles.electricityMessage}>
                              Electricity charge unavailable.
                            </Text>
                          )}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: isSavingMeterReading }}
                            disabled={isSavingMeterReading}
                            onPress={onSaveMeterReading}
                            style={[
                              styles.meterButton,
                              isSavingMeterReading && styles.meterButtonDisabled,
                            ]}>
                            <Text style={styles.meterButtonLabel}>
                              {isSavingMeterReading
                                ? 'Saving…'
                                : meterContext.currentReading
                                  ? 'Calculate charge'
                                  : 'Save reading'}
                            </Text>
                          </Pressable>
                        </>
                      )}
                  </>
                )}
              </>
            ) : !record.billId ? (
              <Text style={styles.electricityMessage}>No electricity charge.</Text>
            ) : meterContextLoading ? (
              <Text style={styles.electricityMessage}>Loading readings…</Text>
            ) : meterContextError ? (
              <Text accessibilityLiveRegion="polite" style={styles.electricityMessage}>
                Meter readings unavailable.
              </Text>
            ) : !meterContext?.previousReading ? (
              <Text style={styles.electricityMessage}>Previous reading unavailable.</Text>
            ) : !meterContext.readingDateValid ? (
              <Text style={styles.electricityMessage}>No present reading for this bill.</Text>
            ) : (
              <>
                <Line
                  label="Previous Reading"
                  value={`${meterContext.previousReading.value.toLocaleString()} kWh`}
                />
                {meterContext.currentReading ? (
                  <>
                    <Line
                      label="Present Reading"
                      value={`${meterContext.currentReading.value.toLocaleString()} kWh`}
                    />
                    <Line
                      label="Electricity Consumed"
                      value={`${(
                        meterContext.currentReading.value - meterContext.previousReading.value
                      ).toLocaleString()} kWh`}
                    />
                  </>
                ) : (
                  <Text style={styles.electricityMessage}>Present reading unavailable.</Text>
                )}
                {meterContext.rate === null ? (
                  <Text style={styles.electricityMessage}>
                    Configure an electricity rate to continue.
                  </Text>
                ) : (
                  <Line label="Rate per kWh" value={formatPeso(meterContext.rate)} />
                )}
                <Text style={styles.electricityMessage}>Electricity charge unavailable.</Text>
                {canRecordMeterReading &&
                  meterContext &&
                  meterContext.rate !== null && (
                    <>
                      {!meterContext.currentReading && (
                        <TextInput
                          accessibilityLabel="Present meter reading in kilowatt-hours"
                          style={styles.meterInput}
                          value={meterReadingValue}
                          onChangeText={onChangeMeterReading}
                          keyboardType="decimal-pad"
                          placeholder="Present reading (kWh)"
                          placeholderTextColor="#8A94A6"
                          editable={!isSavingMeterReading}
                        />
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: isSavingMeterReading }}
                        disabled={isSavingMeterReading}
                        onPress={onSaveMeterReading}
                        style={[
                          styles.meterButton,
                          isSavingMeterReading && styles.meterButtonDisabled,
                        ]}>
                        <Text style={styles.meterButtonLabel}>
                          {isSavingMeterReading
                            ? 'Saving…'
                            : meterContext.currentReading
                              ? 'Calculate charge'
                              : 'Save reading'}
                        </Text>
                      </Pressable>
                    </>
                  )}
              </>
            )}
          </View>
        )}
        {!record.billId && (
          <Text style={styles.billNotGenerated}>This bill has not been generated yet.</Text>
        )}

        <View style={styles.sumRule} />
        <Line label="TOTAL AMOUNT DUE" value={formatPeso(totalAmount)} bold />
      </View>
      <Rule />

      <View style={styles.statusRow}>
        <Text style={styles.text}>Payment Status:</Text>
        <StatusBox
          label="UNPAID"
          checked={record.status === 'unpaid'}
          onPress={() => onChangeStatus('unpaid')}
        />
        <StatusBox
          label="PAID"
          checked={record.status === 'paid'}
          onPress={() => onChangeStatus('paid')}
        />
      </View>
      {record.status === 'paid' && record.paidDate && (
        <Text style={styles.paidOn}>Paid on {formatShortDate(record.paidDate)}</Text>
      )}

      <DoubleRule />
      <Text style={styles.reminder}>{PAYMENT_REMINDER}</Text>
      <DoubleRule />
    </View>
  );
}

/* ---------- small building blocks ---------- */

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.text, styles.fieldLabel]}>{label}:</Text>
      <Text style={[styles.text, styles.fieldValue]}>{value}</Text>
    </View>
  );
}

function Line({
  label,
  value,
  bold,
  detail,
}: {
  label: string;
  value: string;
  bold?: boolean;
  detail?: string;
}) {
  return (
    <View style={styles.lineRow}>
      <View style={styles.lineCopy}>
        <Text style={[styles.text, bold && styles.bold, styles.lineLabel]}>{label}</Text>
        {detail && <Text style={styles.itemDetail}>{detail}</Text>}
      </View>
      <Text style={[styles.text, bold && styles.bold]}>{value}</Text>
    </View>
  );
}

function itemLabel(itemType: string, description: string | null) {
  if (description) return description;
  switch (itemType) {
    case 'rent':
      return 'Room rent';
    case 'water':
      return 'Water';
    case 'trash':
      return 'Trash';
    case 'wifi':
      return 'Wi-Fi';
    case 'electricity':
      return 'Electricity';
    default:
      return 'Adjustment';
  }
}

function StatusBox({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.statusBox}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={22}
        color={checked ? '#1A2B3C' : '#6B7280'}
      />
      <Text style={[styles.text, checked && styles.bold]}>{label}</Text>
    </Pressable>
  );
}

function Rule() {
  return <View style={styles.rule} />;
}

function DoubleRule() {
  return (
    <View style={styles.doubleRule}>
      <View style={styles.doubleRuleLine} />
      <View style={styles.doubleRuleLine} />
    </View>
  );
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: 'white',
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  title: {
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#1A2B3C',
    textAlign: 'center',
  },
  sectionTitle: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: '700',
    color: '#1A2B3C',
  },
  text: {
    fontFamily: MONO,
    fontSize: 13,
    color: '#1A2B3C',
  },
  bold: {
    fontWeight: '700',
    fontSize: 14,
  },
  block: {
    gap: 4,
  },
  gap: {
    height: 8,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fieldLabel: {
    width: 128,
  },
  fieldValue: {
    flex: 1,
    fontWeight: '600',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  billNotGenerated: {
    color: '#64748B',
    fontFamily: MONO,
    fontSize: 11,
    textAlign: 'center',
  },
  electricitySection: {
    gap: 6,
  },
  electricityTitle: {
    color: '#1A2B3C',
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: '700',
  },
  electricityMessage: {
    color: '#64748B',
    fontFamily: MONO,
    fontSize: 11,
  },
  missedReadingCard: {
    gap: 8,
    padding: 10,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEB',
  },
  missedReadingDescription: {
    color: '#713F12',
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 17,
  },
  lateReadingCard: {
    gap: 8,
    padding: 10,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#93C5FD',
    backgroundColor: '#EFF6FF',
  },
  lateReadingDescription: {
    color: '#1E3A8A',
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 17,
  },
  readingDateLabel: {
    color: '#1A2B3C',
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: '700',
  },
  readingDateField: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
  readingDateText: {
    flex: 1,
    color: '#1A2B3C',
    fontFamily: MONO,
    fontSize: 12,
  },
  meterError: {
    color: '#B91C1C',
    fontFamily: MONO,
    fontSize: 11,
  },
  meterInput: {
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    color: '#1A2B3C',
    fontSize: 15,
  },
  meterButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    backgroundColor: '#2563EB',
  },
  meterButtonDisabled: {
    opacity: 0.6,
  },
  correctReadingButton: {
    alignSelf: 'flex-end',
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#BFD3EE',
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
  },
  correctReadingButtonDisabled: {
    opacity: 0.55,
  },
  correctReadingLabel: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '700',
  },
  meterButtonLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryMeterButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
  },
  secondaryMeterButtonLabel: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '700',
  },
  rollForwardCard: {
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 7,
    backgroundColor: '#EFF6FF',
  },
  rollForwardNotice: {
    color: '#1E3A8A',
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 17,
  },
  datePickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  datePickerSheet: {
    padding: 16,
    gap: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  datePickerDoneButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    backgroundColor: '#2563EB',
  },
  datePickerDoneLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  lineLabel: {
    flexShrink: 1,
  },
  lineCopy: {
    flex: 1,
    gap: 2,
  },
  itemDetail: {
    fontFamily: MONO,
    fontSize: 10,
    color: '#64748B',
  },
  sumRule: {
    alignSelf: 'flex-end',
    width: 96,
    height: 1,
    backgroundColor: '#1A2B3C',
  },
  rule: {
    height: 1,
    backgroundColor: '#B8C0CC',
  },
  doubleRule: {
    gap: 3,
  },
  doubleRuleLine: {
    height: 1.5,
    backgroundColor: '#1A2B3C',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paidOn: {
    fontFamily: MONO,
    fontSize: 12,
    color: '#6B7280',
  },
  reminder: {
    fontFamily: MONO,
    fontSize: 12,
    color: '#1A2B3C',
    textAlign: 'center',
  },
});