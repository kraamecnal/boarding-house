import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { BillRecord, BillStatus } from '@/contexts/BillsContext';
import type { OccupiedRoom } from '@/contexts/RoomsContext';
import { FIXED_COSTS_LABEL, PAYMENT_REMINDER } from '@/data/billingConfig';
import { computeTotals, formatPeso, formatShortDate, periodLabel } from '@/utils/billing';
import type { BillMeterContext } from '@/utils/meterBilling';

type Props = {
  room: OccupiedRoom;
  record: BillRecord;
  meterContext: BillMeterContext | null;
  meterContextLoading: boolean;
  meterContextError: string | null;
  meterReadingValue: string;
  isSavingMeterReading: boolean;
  onChangeMeterReading: (text: string) => void;
  onSaveMeterReading: () => void;
  onChangeStatus: (status: BillStatus) => void;
};

export default function BillStatement({
  room,
  record,
  meterContext,
  meterContextLoading,
  meterContextError,
  meterReadingValue,
  isSavingMeterReading,
  onChangeMeterReading,
  onSaveMeterReading,
  onChangeStatus,
}: Props) {
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

  return (
    <View style={styles.sheet}>
      <DoubleRule />
      <Text style={styles.title}>MONTHLY BILLING STATEMENT</Text>
      <DoubleRule />

      <View style={styles.block}>
        <Field label="Room No." value={room.roomName} />
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
            {meteredElectricity ? (
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
                {!record.isFinalized &&
                  record.status !== 'paid' &&
                  meterContext?.saved &&
                  meterContext.currentReading && (
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
                        {isSavingMeterReading ? 'Issuing…' : 'Issue bill'}
                      </Text>
                    </Pressable>
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
  meterButtonLabel: {
    color: '#FFFFFF',
    fontSize: 13,
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