import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import AnimatedButton from '@/components/AnimatedButton';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useRooms } from '@/contexts/RoomsContext';
import { sanitizeAmountInput } from '@/utils/billing';
import {
  dateFromLocalIso,
  parseMeterReadingInput,
  sanitizeMeterReadingInput,
  toLocalIsoDate,
} from '@/utils/meterReadings';

const MAX_ROOM_NAME = 30;

function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function displayDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function NewRoomScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const boardingHouseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { getHouseById } = useBoardingHouses();
  const { addRoom, isRoomNameTaken } = useRooms();
  const house = boardingHouseId ? getHouseById(boardingHouseId) : undefined;
  const requestId = useRef(newRequestId()).current;

  const [roomName, setRoomName] = useState('');
  const [monthlyRate, setMonthlyRate] = useState('');
  const [addInitialReading, setAddInitialReading] = useState(false);
  const [initialReadingValue, setInitialReadingValue] = useState('');
  const [initialReadingDate, setInitialReadingDate] = useState(toLocalIsoDate(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!boardingHouseId) return;
    const trimmedName = roomName.trim();
    const rate = Number(monthlyRate);

    if (!trimmedName) return Alert.alert('Missing info', 'Please enter a room name.');
    if (isRoomNameTaken(boardingHouseId, trimmedName)) {
      return Alert.alert(
        'Name already used',
        `${house?.name ?? 'This boarding house'} already has a room named "${trimmedName}".`
      );
    }
    if (!monthlyRate.trim() || Number.isNaN(rate) || rate <= 0) {
      return Alert.alert('Missing info', 'Please enter a monthly rate greater than 0.');
    }
    let initialMeterReading: { value: number; readingAt: string } | null = null;
    if (addInitialReading) {
      const value = parseMeterReadingInput(initialReadingValue);
      if (value === null) {
        return Alert.alert('Invalid reading', 'Enter a valid nonnegative meter reading.');
      }
      const today = toLocalIsoDate(new Date());
      if (initialReadingDate > today) {
        return Alert.alert('Invalid date', 'The reading date cannot be in the future.');
      }
      initialMeterReading = { value, readingAt: initialReadingDate };
    }

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await addRoom({
        boardingHouseId,
        roomName: trimmedName,
        monthlyRate: rate,
        requestId,
        initialMeterReading,
      });
      router.back();
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : 'Could not register this room.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {house && <Text style={styles.houseHint}>Adding a room to {house.name}</Text>}

        <Text style={styles.label}>Room name or number</Text>
        <TextInput
          style={styles.input}
          value={roomName}
          onChangeText={setRoomName}
          placeholder="e.g. Room 3B"
          placeholderTextColor="#8A94A6"
          maxLength={MAX_ROOM_NAME}
        />

        <Text style={styles.label}>Monthly rent (₱)</Text>
        <TextInput
          style={styles.input}
          value={monthlyRate}
          onChangeText={(text) => setMonthlyRate(sanitizeAmountInput(text))}
          keyboardType="decimal-pad"
          placeholder="e.g. 3500"
          placeholderTextColor="#8A94A6"
          maxLength={10}
        />

        <View style={styles.meterCard}>
          <View style={styles.meterHeader}>
            <View style={styles.meterIcon}>
              <Ionicons name="flash" size={22} color="#2563EB" />
            </View>
            <View style={styles.meterTitleCopy}>
              <View style={styles.meterTitleRow}>
                <Text style={styles.meterTitle}>Electricity meter</Text>
                <Text style={styles.optional}>Optional</Text>
              </View>
              <Text style={styles.meterDescription}>
                You can add the initial meter reading now or set it later.
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: addInitialReading, disabled: isSubmitting }}
            disabled={isSubmitting}
            onPress={() => setAddInitialReading((checked) => !checked)}
            style={styles.checkboxRow}>
            <Ionicons
              name={addInitialReading ? 'checkbox' : 'square-outline'}
              size={22}
              color={addInitialReading ? '#2563EB' : '#64748B'}
            />
            <Text style={styles.checkboxLabel}>Add initial meter reading</Text>
          </Pressable>

          {addInitialReading && (
            <View style={styles.readingFields}>
              <Text style={styles.label}>Initial meter reading (kWh)</Text>
              <TextInput
                style={styles.input}
                value={initialReadingValue}
                onChangeText={(text) => setInitialReadingValue(sanitizeMeterReadingInput(text))}
                keyboardType="decimal-pad"
                placeholder="e.g. 1250.5"
                placeholderTextColor="#8A94A6"
                accessibilityLabel="Initial meter reading in kilowatt-hours"
              />
              <Text style={styles.label}>Reading date</Text>
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => setShowDatePicker(true)}
                style={styles.dateField}>
                <Text style={styles.dateText}>
                  {displayDate(dateFromLocalIso(initialReadingDate))}
                </Text>
                <Ionicons name="calendar-outline" size={20} color="#1E3A8A" />
              </Pressable>
              <Text style={styles.readingHelper}>
                Enter the current value shown on the physical meter. This will be the starting
                point for the next reading.
              </Text>
              {Platform.OS === 'android' && showDatePicker && (
                <DateTimePicker
                  value={dateFromLocalIso(initialReadingDate)}
                  mode="date"
                  display="default"
                  maximumDate={new Date()}
                  onValueChange={(_event, selected) => {
                    setShowDatePicker(false);
                    if (selected) setInitialReadingDate(toLocalIsoDate(selected));
                  }}
                  onDismiss={() => setShowDatePicker(false)}
                />
              )}
              {Platform.OS === 'ios' && (
                <Modal
                  visible={showDatePicker}
                  transparent
                  animationType="slide"
                  onRequestClose={() => setShowDatePicker(false)}>
                  <View style={styles.modalOverlay}>
                    <View style={styles.modalSheet}>
                      <DateTimePicker
                        value={dateFromLocalIso(initialReadingDate)}
                        mode="date"
                        display="inline"
                        maximumDate={new Date()}
                        onValueChange={(_event, selected) => {
                          if (selected) setInitialReadingDate(toLocalIsoDate(selected));
                        }}
                      />
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setShowDatePicker(false)}
                        style={styles.doneButton}>
                        <Text style={styles.doneLabel}>Done</Text>
                      </Pressable>
                    </View>
                  </View>
                </Modal>
              )}
            </View>
          )}
        </View>

        <Text style={styles.note}>The room starts as Vacant. Tap it later to register a tenant.</Text>

        {submitError && <Text accessibilityLiveRegion="polite" style={styles.error}>{submitError}</Text>}
        <View style={styles.submitWrapper}>
          <AnimatedButton
            disabled={isSubmitting}
            label={isSubmitting ? 'Saving…' : 'Create Room'}
            onPress={() => void handleSubmit()}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 48,
    backgroundColor: 'white',
    gap: 6,
    flexGrow: 1,
  },
  houseHint: {
    color: '#6B7280',
    fontSize: 13,
  },
  label: {
    color: '#1A2B3C',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1A2B3C',
  },
  meterCard: {
    marginTop: 16,
    padding: 14,
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    backgroundColor: '#F8FBFF',
  },
  meterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  meterIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  meterTitleCopy: {
    flex: 1,
    gap: 3,
  },
  meterTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  meterTitle: {
    color: '#1E3A8A',
    fontSize: 16,
    fontWeight: '700',
  },
  optional: {
    color: '#64748B',
    fontSize: 12,
  },
  meterDescription: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
  },
  checkboxRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkboxLabel: {
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '600',
  },
  readingFields: {
    gap: 4,
  },
  dateField: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  dateText: {
    color: '#1E293B',
    fontSize: 15,
  },
  readingHelper: {
    marginTop: 4,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  modalSheet: {
    alignItems: 'center',
    gap: 12,
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  doneButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'stretch',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#2563EB',
  },
  doneLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  note: {
    marginTop: 8,
    color: '#6B7280',
    fontSize: 12,
  },
  error: {
    marginTop: 10,
    color: '#B42318',
    fontSize: 13,
  },
  submitWrapper: {
    marginTop: 28,
    alignItems: 'center',
  },
});