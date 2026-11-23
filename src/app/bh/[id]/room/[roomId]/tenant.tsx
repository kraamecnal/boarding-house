import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
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

import AnimatedButton from '@/components/AnimatedButton';
import ImageField from '@/components/ImageField';
import RoomLabel, { formatRoomLabel } from '@/components/RoomLabel';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useAuth } from '@/contexts/AuthContext';
import { addOneMonth, useRooms } from '@/contexts/RoomsContext';
import { CHARGES, isChargeType, type ChargeType } from '@/data/charges';
import type {
  TenantDocumentImage,
  TenantDocumentProgressState,
} from '@/data/tenantDocuments';
import { formatPeso, sanitizeAmountInput } from '@/utils/billing';
import { parseMeterReadingInput, sanitizeMeterReadingInput } from '@/utils/meterReadings';
import { getSupabaseClient } from '@/utils/supabase';

const DECIMAL_AMOUNT = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;

function toIsoDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toDisplayDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
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

export default function RegisterTenantScreen() {
  const params = useLocalSearchParams<{ id: string; roomId: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const router = useRouter();
  const { getRoomById, assignTenant, isLoading: isLoadingRooms, loadError: roomsError } = useRooms();
  const { getHouseById } = useBoardingHouses();
  const { session } = useAuth();
  const ownerId = session?.user.id;
  const room = roomId ? getRoomById(roomId) : undefined;
  const houseName = room ? getHouseById(room.boardingHouseId)?.name : undefined;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [availableFromDate, setAvailableFromDate] = useState<string | null>(null);
  const [openingMeterReading, setOpeningMeterReading] = useState('');
  const [existingOpeningMeterReading, setExistingOpeningMeterReading] = useState<number | null>(
    null,
  );
  const [isLoadingOpeningMeterReading, setIsLoadingOpeningMeterReading] = useState(false);
  const [openingMeterReadingError, setOpeningMeterReadingError] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [idImage, setIdImage] = useState<TenantDocumentImage | null>(null);
  const [contractImage, setContractImage] = useState<TenantDocumentImage | null>(null);
  const [documentProgress, setDocumentProgress] = useState<
    Record<'id' | 'agreement', TenantDocumentProgressState>
  >({ id: 'idle', agreement: 'idle' });
  const [customChargesEnabled, setCustomChargesEnabled] = useState(false);
  const [selectedCustomCharges, setSelectedCustomCharges] = useState<Record<ChargeType, boolean>>({
    water: false,
    wifi: false,
    trash: false,
    electricity: false,
  });
  const [customChargeValues, setCustomChargeValues] = useState<Partial<Record<ChargeType, string>>>({});
  const [chargeErrors, setChargeErrors] = useState<Partial<Record<ChargeType, string>>>({});
  const [defaultChargeRates, setDefaultChargeRates] = useState<Partial<Record<ChargeType, number>>>({});
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(true);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);
  const [defaultsAttempt, setDefaultsAttempt] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlight = useRef(false);

  useEffect(() => {
    let isCurrent = true;

    const loadDefaultRates = async () => {
      setIsLoadingDefaults(true);
      setDefaultsError(null);
      if (!ownerId || !room) {
        setIsLoadingDefaults(false);
        return;
      }

      try {
        const client = getSupabaseClient();
        const { data: ownerRows, error: ownerError } = await client
          .from('owner_default_charges')
          .select('item_type, unit_price')
          .eq('owner_id', ownerId);
        if (ownerError) throw ownerError;

        const rates: Partial<Record<ChargeType, number>> = {};
        for (const row of ownerRows ?? []) {
          if (isChargeType(row.item_type)) rates[row.item_type] = Number(row.unit_price);
        }
        if (isCurrent) setDefaultChargeRates(rates);
      } catch (error: unknown) {
        if (isCurrent) {
          setDefaultsError(getErrorMessage(error, 'Could not load the standard charge rates.'));
        }
      } finally {
        if (isCurrent) setIsLoadingDefaults(false);
      }
    };

    void loadDefaultRates();
    return () => {
      isCurrent = false;
    };
  }, [defaultsAttempt, ownerId, room]);

  useEffect(() => {
    let isCurrent = true;
    setAvailableFromDate(null);
    if (!room) return;

    const loadAvailabilityDate = async () => {
      const { data, error } = await getSupabaseClient()
        .from('tenancy')
        .select('move_out_date')
        .eq('room_id', room.id)
        .not('move_out_date', 'is', null)
        .order('move_out_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!isCurrent) return;
      if (error) {
        setSubmitError(
          `Could not determine when this room became available. ${getErrorMessage(
            error,
            'Please try again.',
          )}`,
        );
        return;
      }
      setAvailableFromDate(data?.move_out_date ?? null);
    };

    void loadAvailabilityDate();
    return () => {
      isCurrent = false;
    };
  }, [room]);

  useEffect(() => {
    let isCurrent = true;
    const selectedDate = startDate ? toIsoDate(startDate) : null;

    setExistingOpeningMeterReading(null);
    setOpeningMeterReading('');
    setOpeningMeterReadingError(null);

    if (!room || !selectedDate) {
      setIsLoadingOpeningMeterReading(false);
      return;
    }

    const loadOpeningMeterReading = async () => {
      setIsLoadingOpeningMeterReading(true);
      try {
        const { data, error } = await getSupabaseClient()
          .from('meter_readings')
          .select('reading_value')
          .eq('room_id', room.id)
          .eq('reading_at', selectedDate)
          .maybeSingle();
        if (error) throw error;

        if (isCurrent) {
          const value = data ? Number(data.reading_value) : null;
          setExistingOpeningMeterReading(
            value !== null && Number.isFinite(value) ? value : null,
          );
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setOpeningMeterReadingError(
            getErrorMessage(error, 'Could not check the room’s existing move-in reading.'),
          );
        }
      } finally {
        if (isCurrent) setIsLoadingOpeningMeterReading(false);
      }
    };

    void loadOpeningMeterReading();
    return () => {
      isCurrent = false;
    };
  }, [room, startDate]);

  const dueDatePreview = useMemo(() => {
    if (!startDate) return null;
    return addOneMonth(toIsoDate(startDate));
  }, [startDate]);

  const handleDateSelected = (_event: unknown, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selected) setStartDate(selected);
  };

  const handleDatePickerDismiss = () => {
    setShowDatePicker(false);
  };

  if (!room) {
    return (
      <View style={styles.centered}>
        {isLoadingRooms ? (
          <ActivityIndicator color="#2563EB" size="large" />
        ) : (
          <Text style={styles.centeredText}>{roomsError ?? 'Room not found.'}</Text>
        )}
      </View>
    );
  }

  if (room.status === 'occupied') {
    return (
      <View style={styles.centered}>
        <Text style={styles.centeredText}>
          {formatRoomLabel(room.roomName, houseName)} already has a tenant.
        </Text>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (submissionInFlight.current || isSubmitting) return;
    if (!firstName.trim() || !lastName.trim())
      return Alert.alert('Missing info', "Please enter the tenant's full name.");
    if (!email.trim()) return Alert.alert('Missing info', 'Please enter an email address.');
    if (!contactNumber.trim())
      return Alert.alert('Missing info', 'Please enter a contact number.');
    if (!startDate) return Alert.alert('Missing info', 'Please pick a start date.');
    if (availableFromDate && toIsoDate(startDate) < availableFromDate) {
      return Alert.alert(
        'Move-in date overlaps the previous tenancy',
        `This room was occupied until ${availableFromDate}. Choose that date or later. If the previous tenant actually left earlier, correct the archived tenancy's move-out date first.`,
      );
    }
    if (isLoadingOpeningMeterReading) {
      return Alert.alert('Please wait', 'We are checking the room’s saved move-in reading.');
    }
    const hasStarted = toIsoDate(startDate) <= toIsoDate(new Date());
    const openingReadingValue =
      existingOpeningMeterReading ??
      (hasStarted && openingMeterReading.trim()
        ? parseMeterReadingInput(openingMeterReading)
        : null);
    if (hasStarted && openingMeterReading.trim() && openingReadingValue === null) {
      return Alert.alert('Invalid reading', 'Enter a valid nonnegative move-in reading.');
    }
    if (hasStarted && openingReadingValue === null) {
      return Alert.alert(
        'Move-in reading required',
        'If your tenant has already moved in, first enter the meter reading from the day they moved in. Then register the tenant.',
      );
    }
    if (!idImage) {
      return Alert.alert('Missing info', "Please attach a photo of the tenant's valid ID.");
    }
    if (!contractImage) {
      return Alert.alert('Missing info', 'Please attach a photo of the signed contract.');
    }

    const nextChargeErrors: Partial<Record<ChargeType, string>> = {};
    const customRates: Partial<Record<ChargeType, string>> = {};
    if (customChargesEnabled) {
      for (const charge of CHARGES) {
        if (!selectedCustomCharges[charge.key]) continue;
        const value = customChargeValues[charge.key]?.trim() ?? '';
        if (!value) {
          nextChargeErrors[charge.key] = 'Enter a unit price for this charge.';
        } else if (!DECIMAL_AMOUNT.test(value) || !Number.isFinite(Number(value))) {
          nextChargeErrors[charge.key] = 'Enter a valid amount with no more than 2 decimal places.';
        } else if (Number(value) < 0) {
          nextChargeErrors[charge.key] = 'Charge amounts cannot be negative.';
        } else {
          customRates[charge.key] = value;
        }
      }
    }
    setChargeErrors(nextChargeErrors);
    if (Object.keys(nextChargeErrors).length > 0) {
      return Alert.alert('Check custom charges', 'Enter a valid nonnegative rate for each selected charge.');
    }

    setSubmitError(null);
    submissionInFlight.current = true;
    setIsSubmitting(true);
    setDocumentProgress({ id: 'idle', agreement: 'idle' });
    try {
      const notice = await assignTenant(
        room.id,
        {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          contactNumber: contactNumber.trim(),
          startDate: toIsoDate(startDate),
          openingMeterReading: openingReadingValue,
          idImage,
          contractImage,
        },
        customChargesEnabled ? customRates : {},
        (kind, state) => {
          setDocumentProgress((current) => ({ ...current, [kind]: state }));
        },
      );
      if (notice) {
        Alert.alert('Tenant registered', notice, [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        router.back();
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Could not register this tenant.');
      setSubmitError(
        message.includes('The reading date must be later than the previous reading')
          ? 'The move-in date you selected is before this room’s latest meter reading. Check the meter history and move-in date, then try again.'
          : message.includes('The existing reading on the move-in date does not match')
            ? 'A different meter reading is already saved for this move-in date. Use the room’s existing handoff reading to register this tenant.'
          : message.includes('no_overlapping_tenancies')
            ? 'This move-in date overlaps the previous tenancy. The new tenancy must start on or after the previous move-out date.'
          : message,
      );
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.roomBanner}>
          <RoomLabel
            boardingHouseName={houseName}
            roomName={room.roomName}
            style={styles.roomBannerName}
          />
          <Text style={styles.roomBannerRate}>{formatPeso(room.monthlyRate)} / month</Text>
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: customChargesEnabled }}
          onPress={() => setCustomChargesEnabled((enabled) => !enabled)}
          style={styles.customChargeToggle}
        >
          <Ionicons
            color={customChargesEnabled ? '#2563EB' : '#64748B'}
            name={customChargesEnabled ? 'checkbox' : 'square-outline'}
            size={22}
          />
          <View style={styles.customChargeToggleCopy}>
            <Text style={styles.customChargeTitle}>Customize charges</Text>
            <Text style={styles.customChargeDescription}>
              Set different billing charges for this tenancy.
            </Text>
          </View>
        </Pressable>

        {customChargesEnabled && (
          <View style={styles.customCharges}>
            {isLoadingDefaults && (
              <View style={styles.defaultsState}>
                <ActivityIndicator color="#2563EB" size="small" />
                <Text style={styles.defaultsText}>Loading standard rates…</Text>
              </View>
            )}
            {defaultsError && (
              <View style={styles.defaultsError}>
                <Text style={styles.defaultsErrorText}>{defaultsError}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDefaultsAttempt((attempt) => attempt + 1)}
                  style={styles.retryDefaults}
                >
                  <Text style={styles.retryDefaultsText}>Try again</Text>
                </Pressable>
              </View>
            )}
            {CHARGES.map((charge) => {
              const checked = selectedCustomCharges[charge.key];
              const defaultRate = defaultChargeRates[charge.key];
              return (
                <View key={charge.key} style={styles.chargeCard}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() => {
                      setSelectedCustomCharges((current) => ({
                        ...current,
                        [charge.key]: !current[charge.key],
                      }));
                      setChargeErrors((current) => ({ ...current, [charge.key]: undefined }));
                    }}
                    style={styles.chargeChoice}
                  >
                    <Ionicons
                      color={checked ? '#2563EB' : '#64748B'}
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={21}
                    />
                    <View style={styles.chargeCopy}>
                      <Text style={styles.chargeLabel}>{charge.label}</Text>
                      <Text style={styles.chargePeriod}>
                        Standard:{' '}
                        {defaultRate === undefined
                          ? 'not set'
                          : `${formatPeso(defaultRate)} ${
                              charge.key === 'electricity' ? 'per kWh' : 'per bill'
                            }`}
                      </Text>
                    </View>
                  </Pressable>
                  {checked && (
                    <View style={styles.chargeInputSection}>
                      <Text style={styles.unitPriceLabel}>Unit price · {charge.period}</Text>
                      <View
                        style={[
                          styles.unitPriceField,
                          chargeErrors[charge.key] && styles.unitPriceFieldError,
                        ]}
                      >
                        <Text style={styles.pesoPrefix}>₱</Text>
                        <TextInput
                          accessibilityLabel={`${charge.label} unit price in pesos ${charge.period}`}
                          keyboardType="decimal-pad"
                          maxLength={10}
                          onChangeText={(text) => {
                            setCustomChargeValues((current) => ({
                              ...current,
                              [charge.key]: sanitizeAmountInput(text),
                            }));
                            setChargeErrors((current) => ({ ...current, [charge.key]: undefined }));
                          }}
                          placeholder="0.00"
                          placeholderTextColor="#94A3B8"
                          selectTextOnFocus
                          style={styles.unitPriceInput}
                          value={customChargeValues[charge.key] ?? ''}
                        />
                        {charge.key === 'electricity' && <Text style={styles.unitSuffix}>/ kWh</Text>}
                      </View>
                      {chargeErrors[charge.key] && (
                        <Text style={styles.chargeError}>{chargeErrors[charge.key]}</Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.label}>First name</Text>
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />

        <Text style={styles.label}>Last name</Text>
        <TextInput style={styles.input} value={lastName} onChangeText={setLastName} />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Contact number</Text>
        <TextInput
          style={styles.input}
          value={contactNumber}
          onChangeText={setContactNumber}
          keyboardType="phone-pad"
        />

        <Text style={styles.label}>Start date</Text>
        <Pressable style={styles.dateField} onPress={() => setShowDatePicker(true)}>
          <Text style={startDate ? styles.dateText : styles.datePlaceholder}>
            {startDate ? toDisplayDate(startDate) : 'Select start date'}
          </Text>
          <Ionicons name="calendar-outline" size={20} color="#1A2B3C" />
        </Pressable>
        {availableFromDate && (
          <Text style={styles.readingHelper}>
            This room is available from {availableFromDate}. If the previous tenant left earlier,
            correct that tenancy&apos;s move-out date before registering a replacement.
          </Text>
        )}

        <Text style={styles.label}>Move-in reading (kWh)</Text>
        {startDate && toIsoDate(startDate) <= toIsoDate(new Date()) ? (
          <>
            {isLoadingOpeningMeterReading ? (
              <View style={styles.readingState}>
                <ActivityIndicator color="#2563EB" size="small" />
                <Text style={styles.readingHelper}>Checking for an existing move-in reading…</Text>
              </View>
            ) : existingOpeningMeterReading !== null ? (
              <>
                <View style={styles.existingReadingField}>
                  <Text style={styles.existingReadingValue}>
                    {existingOpeningMeterReading.toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                  <Text style={styles.existingReadingUnit}>kWh</Text>
                </View>
                <Text style={styles.readingHelper}>
                  This reading is already saved for the room on the move-in date. It will be reused
                  as the new tenant&apos;s opening reading.
                </Text>
              </>
            ) : (
              <>
                <TextInput
                  accessibilityLabel="Move-in reading in kilowatt-hours"
                  style={styles.input}
                  value={openingMeterReading}
                  onChangeText={(text) => setOpeningMeterReading(sanitizeMeterReadingInput(text))}
                  keyboardType="decimal-pad"
                  placeholder="Number shown on the electricity meter"
                  placeholderTextColor="#8A94A6"
                />
                <Text style={styles.readingHelper}>
                  Enter the number shown on the electricity meter on the move-in date. This is the
                  tenant&apos;s starting point, so they are not charged for earlier use.
                </Text>
                {openingMeterReadingError && (
                  <Text accessibilityLiveRegion="polite" style={styles.submitError}>
                    {openingMeterReadingError}
                  </Text>
                )}
              </>
            )}
          </>
        ) : (
          <Text style={styles.readingHelper}>
            For a future move-in, record the meter number on the move-in date before billing
            electricity.
          </Text>
        )}

        {dueDatePreview && (
          <Text style={styles.dueDateHint}>Due date will be set to {dueDatePreview}</Text>
        )}

        {Platform.OS === 'android' && showDatePicker && (
          <DateTimePicker
            value={startDate ?? new Date()}
            mode="date"
            display="default"
            minimumDate={availableFromDate ? new Date(`${availableFromDate}T00:00:00`) : undefined}
            onValueChange={handleDateSelected}
            onDismiss={handleDatePickerDismiss}
          />
        )}

        {Platform.OS === 'ios' && (
          <Modal visible={showDatePicker} transparent animationType="slide">
            <View style={styles.modalOverlay}>
              <View style={styles.modalSheet}>
                <DateTimePicker
                  value={startDate ?? new Date()}
                  mode="date"
                  display="inline"
                  minimumDate={
                    availableFromDate ? new Date(`${availableFromDate}T00:00:00`) : undefined
                  }
                  onValueChange={handleDateSelected}
                />
                <AnimatedButton label="Done" onPress={() => setShowDatePicker(false)} />
              </View>
            </View>
          </Modal>
        )}

        <ImageField
          label="Valid ID"
          image={idImage}
          onChange={setIdImage}
          placeholder="Tap to attach a photo of a valid ID"
          isUploading={documentProgress.id === 'uploading'}
          progressState={documentProgress.id}
          disabled={isSubmitting}
        />

        <ImageField
          label="Contract"
          image={contractImage}
          onChange={setContractImage}
          placeholder="Tap to attach a photo of the signed contract"
          isUploading={documentProgress.agreement === 'uploading'}
          progressState={documentProgress.agreement}
          disabled={isSubmitting}
        />

        {submitError && <Text accessibilityLiveRegion="polite" style={styles.submitError}>{submitError}</Text>}
        <View style={styles.submitWrapper}>
          <AnimatedButton
            disabled={isSubmitting}
            label={isSubmitting ? 'Saving…' : 'Register Tenant'}
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
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    backgroundColor: 'white',
  },
  centeredText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
  },
  roomBanner: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    gap: 2,
  },
  roomBannerName: {
    color: '#1E3A8A',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
  },
  roomBannerRate: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  customChargeToggle: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    paddingHorizontal: 2,
  },
  customChargeToggleCopy: {
    flex: 1,
    gap: 2,
  },
  customChargeTitle: {
    color: '#1E3A8A',
    fontSize: 15,
    fontWeight: '700',
  },
  customChargeDescription: {
    color: '#64748B',
    fontSize: 13,
  },
  customCharges: {
    gap: 10,
    marginBottom: 6,
  },
  defaultsState: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
  },
  defaultsText: {
    color: '#64748B',
    fontSize: 13,
  },
  defaultsError: {
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FEF3F2',
  },
  defaultsErrorText: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 19,
  },
  retryDefaults: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  retryDefaultsText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  chargeCard: {
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  chargeChoice: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chargeCopy: {
    flex: 1,
    gap: 3,
  },
  chargeLabel: {
    color: '#1E3A8A',
    fontSize: 14,
    fontWeight: '600',
  },
  chargePeriod: {
    color: '#64748B',
    fontSize: 12,
  },
  chargeInputSection: {
    gap: 6,
  },
  unitPriceLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  unitPriceField: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  unitPriceFieldError: {
    borderColor: '#B42318',
  },
  pesoPrefix: {
    color: '#1E3A8A',
    fontSize: 15,
    fontWeight: '600',
  },
  unitPriceInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 9,
    color: '#0F172A',
    fontSize: 15,
  },
  unitSuffix: {
    color: '#64748B',
    fontSize: 13,
  },
  chargeError: {
    color: '#B42318',
    fontSize: 12,
  },
  submitError: {
    marginTop: 16,
    color: '#B42318',
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
  readingHelper: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
  },
  readingState: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  existingReadingField: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
  },
  existingReadingValue: {
    color: '#1E3A8A',
    fontSize: 17,
    fontWeight: '700',
  },
  existingReadingUnit: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  dateField: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: {
    fontSize: 16,
    color: '#1A2B3C',
  },
  datePlaceholder: {
    fontSize: 16,
    color: '#8A94A6',
  },
  dueDateHint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  modalSheet: {
    backgroundColor: 'white',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 12,
    alignItems: 'center',
  },
  submitWrapper: {
    marginTop: 28,
    alignItems: 'center',
  },
});