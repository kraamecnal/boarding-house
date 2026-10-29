import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

import { useRooms } from '@/contexts/RoomsContext';
import { formatShortDate, todayIso } from '@/utils/billing';
import {
  dateFromLocalIso,
  getRoomMeterReadings,
  hasReadingInBillingCycle,
  meterReadingErrorMessage,
  parseMeterReadingInput,
  recordRoomMeterReading,
  sanitizeMeterReadingInput,
  toLocalIsoDate,
  type MeterReading,
} from '@/utils/meterReadings';

function displayDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function AddMeterReadingScreen() {
  const params = useLocalSearchParams<{ roomId: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const router = useRouter();
  const { getRoomById, isLoading: isLoadingRooms, loadError: roomsError } = useRooms();
  const room = roomId ? getRoomById(roomId) : undefined;

  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [isLoadingReadings, setIsLoadingReadings] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readingValue, setReadingValue] = useState('');
  const [readingDate, setReadingDate] = useState(todayIso());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const latestReading = readings[0];

  useEffect(() => {
    let isCurrent = true;

    const loadReadings = async () => {
      if (!roomId) {
        setIsLoadingReadings(false);
        return;
      }

      setIsLoadingReadings(true);
      setLoadError(null);
      try {
        const result = await getRoomMeterReadings(roomId);
        if (isCurrent) setReadings(result);
      } catch (error: unknown) {
        if (isCurrent) {
          setLoadError(
            meterReadingErrorMessage(error, 'Could not load the latest meter reading.'),
          );
        }
      } finally {
        if (isCurrent) setIsLoadingReadings(false);
      }
    };

    void loadReadings();
    return () => {
      isCurrent = false;
    };
  }, [roomId]);

  const saveReading = async () => {
    if (!roomId || !room || isSubmitting) return;
    setFormError(null);

    const value = parseMeterReadingInput(readingValue);
    if (value === null) {
      setFormError('Enter a valid nonnegative meter reading.');
      return;
    }

    if (readingDate > todayIso()) {
      setFormError('The reading date cannot be in the future.');
      return;
    }

    const isOpeningReading =
      room.tenant?.startDate === readingDate &&
      !readings.some((reading) => reading.readingAt === readingDate);
    if (room.tenant && !isOpeningReading) {
      setFormError(
        'Scheduled readings during a tenancy must be entered from its Monthly Bill so the electricity charge is attached to the bill.',
      );
      return;
    }

    if (latestReading && readingDate <= latestReading.readingAt) {
      setFormError('The reading date must be later than the previous reading.');
      return;
    }

    if (latestReading && value < latestReading.value) {
      setFormError(
        'The new reading is lower than the previous reading. Meter resets need an explicit correction workflow.',
      );
      return;
    }

    if (room.tenant && !isOpeningReading && hasReadingInBillingCycle(room.tenant.startDate, readingDate, readings)) {
      setFormError('A meter reading has already been recorded for this billing cycle.');
      return;
    }

    setIsSubmitting(true);
    try {
      await recordRoomMeterReading(roomId, value, readingDate);
      router.back();
    } catch (error: unknown) {
      setFormError(
        meterReadingErrorMessage(error, 'Could not save this meter reading. Please try again.'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!room) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Add Meter Reading' }} />
        {isLoadingRooms ? (
          <ActivityIndicator color="#2563EB" size="large" />
        ) : (
          <Text style={styles.stateText}>{roomsError ?? 'Room not found.'}</Text>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Add Meter Reading' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={styles.roomSummary}>
          <Text style={styles.roomName}>{room.roomName}</Text>
          {isLoadingReadings ? (
            <ActivityIndicator color="#2563EB" />
          ) : loadError ? (
            <View style={styles.loadErrorRow}>
              <Text style={styles.errorText}>{loadError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setLoadError(null);
                  setIsLoadingReadings(true);
                  void getRoomMeterReadings(room.id)
                    .then(setReadings)
                    .catch((error: unknown) =>
                      setLoadError(
                        meterReadingErrorMessage(
                          error,
                          'Could not load the latest meter reading.',
                        ),
                      ),
                    )
                    .finally(() => setIsLoadingReadings(false));
                }}>
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : latestReading ? (
            <>
              <Text style={styles.summaryLabel}>Latest reading</Text>
              <Text style={styles.summaryValue}>
                {latestReading.value.toLocaleString(undefined, {
                  maximumFractionDigits: 20,
                })}{' '}
                kWh
              </Text>
              <Text style={styles.summaryDate}>{formatShortDate(latestReading.readingAt)}</Text>
            </>
          ) : (
            <Text style={styles.summaryDate}>
              No previous reading. This will establish the initial baseline.
            </Text>
          )}
        </View>

        <View style={styles.formCard}>
          <Text style={styles.label}>Current meter reading (kWh)</Text>
          <TextInput
            accessibilityLabel="Current meter reading in kilowatt-hours"
            style={styles.input}
            value={readingValue}
            onChangeText={(text) => {
              setReadingValue(sanitizeMeterReadingInput(text));
              setFormError(null);
            }}
            keyboardType="decimal-pad"
            placeholder="e.g. 1310.0"
            placeholderTextColor="#94A3B8"
            editable={!isSubmitting}
          />

          <Text style={styles.label}>Reading date</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => setShowDatePicker(true)}
            style={styles.dateField}>
            <Text style={styles.dateText}>{displayDate(dateFromLocalIso(readingDate))}</Text>
            <Ionicons name="calendar-outline" size={20} color="#1E3A8A" />
          </Pressable>

          {Platform.OS === 'android' && showDatePicker && (
            <DateTimePicker
              value={dateFromLocalIso(readingDate)}
              mode="date"
              display="default"
              maximumDate={new Date()}
              onValueChange={(_event, selected) => {
                setShowDatePicker(false);
                if (selected) {
                  setReadingDate(toLocalIsoDate(selected));
                  setFormError(null);
                }
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
                    value={dateFromLocalIso(readingDate)}
                    mode="date"
                    display="inline"
                    maximumDate={new Date()}
                    onValueChange={(_event, selected) => {
                      if (selected) {
                        setReadingDate(toLocalIsoDate(selected));
                        setFormError(null);
                      }
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

          <View style={styles.infoPanel}>
            <Ionicons name="information-circle-outline" size={19} color="#2563EB" />
            <Text style={styles.infoText}>
              {latestReading
                ? `Enter the current value shown on the physical meter. It must be at least the previous reading (${latestReading.value.toLocaleString()} kWh).`
                : 'Enter the current value shown on the physical meter. This reading will be the starting point for future electricity calculations.'}
            </Text>
          </View>

          {formError && (
            <Text accessibilityLiveRegion="polite" style={styles.errorText}>
              {formError}
            </Text>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting || isLoadingReadings || Boolean(loadError)}
          onPress={() => void saveReading()}
          style={({ pressed }) => [
            styles.saveButton,
            (isSubmitting || isLoadingReadings || Boolean(loadError)) && styles.disabledButton,
            pressed && styles.pressedButton,
          ]}>
          <Text style={styles.saveLabel}>{isSubmitting ? 'Saving…' : 'Save Reading'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F8FAFC',
  },
  stateText: {
    color: '#64748B',
    fontSize: 15,
    textAlign: 'center',
  },
  content: {
    flexGrow: 1,
    gap: 16,
    padding: 16,
    paddingBottom: 40,
    backgroundColor: '#F8FAFC',
  },
  roomSummary: {
    padding: 16,
    gap: 5,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
  },
  roomName: {
    color: '#1E3A8A',
    fontSize: 17,
    fontWeight: '700',
  },
  summaryLabel: {
    color: '#64748B',
    fontSize: 13,
  },
  summaryValue: {
    color: '#1E3A8A',
    fontSize: 19,
    fontWeight: '700',
  },
  summaryDate: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  loadErrorRow: {
    alignItems: 'center',
    gap: 8,
  },
  retryLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '700',
  },
  formCard: {
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  label: {
    marginTop: 6,
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    color: '#1E293B',
    fontSize: 16,
  },
  dateField: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
  },
  dateText: {
    color: '#1E293B',
    fontSize: 15,
  },
  infoPanel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
    padding: 11,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
  },
  infoText: {
    flex: 1,
    color: '#1E3A8A',
    fontSize: 12,
    lineHeight: 18,
  },
  errorText: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  saveButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#2563EB',
  },
  saveLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  pressedButton: {
    opacity: 0.85,
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
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    borderRadius: 10,
    backgroundColor: '#2563EB',
  },
  doneLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
