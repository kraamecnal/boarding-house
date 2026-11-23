import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DashboardColors } from '@/constants/theme';
import { formatPeso } from '@/utils/billing';
import { parseMeterReadingInput, sanitizeMeterReadingInput } from '@/utils/meterReadings';

type Props = {
  visible: boolean;
  oldValue: number;
  previousValue: number;
  rate: number;
  currentElectricityCharge: number;
  currentTotal: number;
  onCancel: () => void;
  onSave: (newValue: number) => Promise<void>;
};

export default function CorrectReadingModal({
  visible,
  oldValue,
  previousValue,
  rate,
  currentElectricityCharge,
  currentTotal,
  onCancel,
  onSave,
}: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlight = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setValue('');
    setError(null);
    setIsSaving(false);
    saveInFlight.current = false;
  }, [visible]);

  const parsedValue = parseMeterReadingInput(value);
  const belowPrevious =
    parsedValue !== null && parsedValue < previousValue;
  const unchanged = parsedValue !== null && parsedValue === oldValue;
  const canPreview = parsedValue !== null && !belowPrevious && !unchanged;
  const newUsage = canPreview ? parsedValue - previousValue : null;
  const newCharge = newUsage === null ? null : newUsage * rate;
  const newTotal =
    newCharge === null
      ? null
      : currentTotal - currentElectricityCharge + newCharge;

  const close = () => {
    if (!isSaving) onCancel();
  };

  const save = async () => {
    if (
      parsedValue === null ||
      belowPrevious ||
      unchanged ||
      saveInFlight.current
    ) return;
    saveInFlight.current = true;
    setIsSaving(true);
    setError(null);
    try {
      await onSave(parsedValue);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not save this meter reading correction. Please try again.',
      );
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={close}
      transparent
      visible={visible}>
      <KeyboardAvoidingView style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Correct reading</Text>
          <Text style={styles.subtitle}>
            Enter the correct meter number. The reading date will stay the same.
          </Text>

          <View style={styles.currentReading}>
            <Text style={styles.currentLabel}>Saved reading</Text>
            <Text style={styles.currentValue}>{oldValue.toLocaleString()} kWh</Text>
          </View>

          <Text style={styles.label}>New present reading (kWh)</Text>
          <TextInput
            accessibilityLabel="New present reading in kilowatt-hours"
            editable={!isSaving}
            keyboardType="decimal-pad"
            onChangeText={(text) => {
              setValue(sanitizeMeterReadingInput(text));
              setError(null);
            }}
            onSubmitEditing={() => void save()}
            placeholder="Enter the correct meter number"
            placeholderTextColor="#98A2B3"
            style={styles.input}
            value={value}
          />

          {belowPrevious && (
            <Text style={styles.error}>
              The new reading cannot be lower than the previous reading.
            </Text>
          )}
          {unchanged && (
            <Text style={styles.error}>
              Enter a different meter reading.
            </Text>
          )}

          {newUsage !== null && newCharge !== null && newTotal !== null && (
            <View style={styles.preview}>
              <PreviewRow label="Old reading" value={`${oldValue.toLocaleString()} kWh`} />
              <PreviewRow label="New reading" value={`${parsedValue?.toLocaleString()} kWh`} />
              <PreviewRow label="New units used" value={`${newUsage.toLocaleString()} kWh`} />
              <PreviewRow label="New electricity charge" value={formatPeso(newCharge)} />
              <PreviewRow label="New total" value={formatPeso(newTotal)} bold />
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={close}
              style={[styles.button, styles.cancelButton]}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!canPreview || isSaving}
              onPress={() => void save()}
              style={[
                styles.button,
                styles.saveButton,
                (!canPreview || isSaving) && styles.buttonDisabled,
              ]}>
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.saveLabel}>Save correction</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PreviewRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.previewRow}>
      <Text style={[styles.previewLabel, bold && styles.previewBold]}>{label}</Text>
      <Text style={[styles.previewValue, bold && styles.previewBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(20, 36, 58, 0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 430,
    padding: 20,
    gap: 12,
    borderRadius: 18,
    backgroundColor: DashboardColors.white,
  },
  title: {
    color: DashboardColors.dark,
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 20,
  },
  currentReading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    backgroundColor: DashboardColors.pale,
  },
  currentLabel: {
    color: '#667085',
    fontSize: 13,
  },
  currentValue: {
    color: DashboardColors.dark,
    fontSize: 15,
    fontWeight: '700',
  },
  label: {
    color: DashboardColors.dark,
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 10,
    color: DashboardColors.text,
    fontSize: 16,
  },
  preview: {
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D1E3F8',
    borderRadius: 10,
    backgroundColor: '#F8FBFF',
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  previewLabel: {
    flex: 1,
    color: '#667085',
    fontSize: 13,
  },
  previewValue: {
    color: DashboardColors.dark,
    fontSize: 13,
    textAlign: 'right',
  },
  previewBold: {
    fontWeight: '700',
  },
  error: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  button: {
    minHeight: 46,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    backgroundColor: DashboardColors.white,
  },
  saveButton: {
    backgroundColor: DashboardColors.primary,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  cancelLabel: {
    color: '#344054',
    fontSize: 14,
    fontWeight: '600',
  },
  saveLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
