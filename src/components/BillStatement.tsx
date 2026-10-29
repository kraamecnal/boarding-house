import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { BillRecord, BillStatus } from '@/contexts/BillsContext';
import type { OccupiedRoom } from '@/contexts/RoomsContext';
import { FIXED_COSTS_LABEL, PAYMENT_REMINDER } from '@/data/billingConfig';
import { computeTotals, formatPeso, formatShortDate, periodLabel } from '@/utils/billing';

type Props = {
  room: OccupiedRoom;
  record: BillRecord;
  onChangeElectricity: (text: string) => void;
  electricityValue?: string;
  onCommitElectricity?: (text: string) => void;
  onChangeStatus: (status: BillStatus) => void;
};

export default function BillStatement({
  room,
  record,
  onChangeElectricity,
  electricityValue,
  onCommitElectricity,
  onChangeStatus,
}: Props) {
  const totals = computeTotals(room.monthlyRate, record.electricity);
  const meteredElectricity = record.items.some((item) => item.itemType === 'electricity');
  const displayItems = record.items.filter(
    (item) => !(item.itemType === 'adjustment' && item.description === 'Electricity'),
  );
  const totalAmount = record.billId ? record.totalAmount : totals.total;

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
        <Field label="Bill Date Issued" value={formatShortDate(record.issuedDate)} />
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
              detail={
                item.itemType === 'electricity'
                  ? `${item.quantity} kWh × ${formatPeso(item.unitPrice)}`
                  : undefined
              }
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

        {!meteredElectricity && (
          <View style={styles.lineRow}>
            <Text style={[styles.text, styles.lineLabel]}>Electricity</Text>
            <View style={styles.amountBox}>
              <Text style={styles.peso}>₱</Text>
              <TextInput
                style={styles.amountInput}
                value={electricityValue ?? record.electricity}
                onChangeText={onChangeElectricity}
                onEndEditing={() =>
                  onCommitElectricity?.(electricityValue ?? record.electricity)
                }
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#8A94A6"
                selectTextOnFocus
                editable={Boolean(record.billId) && !record.isFinalized && record.status !== 'paid'}
                maxLength={10}
                accessibilityLabel="Electricity charge in pesos"
              />
            </View>
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
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 136,
    borderWidth: 1,
    borderColor: '#1A2B3C',
    borderRadius: 6,
    backgroundColor: '#F7F8FA',
    paddingHorizontal: 8,
  },
  peso: {
    fontFamily: MONO,
    fontSize: 13,
    color: '#1A2B3C',
  },
  amountInput: {
    flex: 1,
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: '600',
    color: '#1A2B3C',
    textAlign: 'right',
    paddingVertical: 6,
    paddingHorizontal: 4,
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