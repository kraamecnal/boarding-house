import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { useAuth } from '@/contexts/AuthContext';
import { addOneMonth, useRooms } from '@/contexts/RoomsContext';
import { CHARGES, isChargeType, type ChargeType } from '@/data/charges';
import type { TenantDocumentImage, TenantDocumentKind } from '@/data/tenantDocuments';
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

export default function RegisterTenantScreen() {
  const params = useLocalSearchParams<{ id: string; roomId: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const router = useRouter();
  const { getRoomById, assignTenant, isLoading: isLoadingRooms, loadError: roomsError } = useRooms();
  const { session } = useAuth();
  const ownerId = session?.user.id;
  const room = roomId ? getRoomById(roomId) : undefined;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [openingMeterReading, setOpeningMeterReading] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [idImage, setIdImage] = useState<TenantDocumentImage | null>(null);
  const [contractImage, setContractImage] = useState<TenantDocumentImage | null>(null);
  const [uploadingDocument, setUploadingDocument] = useState<TenantDocumentKind | null>(null);
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
        const [
          { data: ownerRows, error: ownerError },
          { data: roomRows, error: roomError },
        ] = await Promise.all([
          client
            .from('owner_default_charges')
            .select('item_type, unit_price')
            .eq('owner_id', ownerId),
          client
            .from('room_default_charges')
            .select('item_type, unit_price')
            .eq('room_id', room.id),
        ]);
        if (ownerError) throw ownerError;
        if (roomError) throw roomError;

        const rates: Partial<Record<ChargeType, number>> = {};
        for (const row of ownerRows ?? []) {
          if (isChargeType(row.item_type)) rates[row.item_type] = Number(row.unit_price);
        }
        for (const row of roomRows ?? []) {
          if (isChargeType(row.item_type) && row.item_type !== 'electricity') {
            rates[row.item_type] = Number(row.unit_price);
          }
        }
        if (isCurrent) setDefaultChargeRates(rates);
      } catch (error: unknown) {
        if (isCurrent) {
          setDefaultsError(
            error instanceof Error ? error.message : 'Could not load the standard charge rates.',
          );
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
        <Text style={styles.centeredText}>{room.roomName} already has a tenant.</Text>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!firstName.trim() || !lastName.trim())
      return Alert.alert('Missing info', "Please enter the tenant's full name.");
    if (!email.trim()) return Alert.alert('Missing info', 'Please enter an email address.');
    if (!contactNumber.trim())
      return Alert.alert('Missing info', 'Please enter a contact number.');
    if (!startDate) return Alert.alert('Missing info', 'Please pick a start date.');
    const hasStarted = toIsoDate(startDate) <= toIsoDate(new Date());
    const openingReadingValue = hasStarted && openingMeterReading.trim()
      ? parseMeterReadingInput(openingMeterReading)
      : null;
    if (hasStarted && openingMeterReading.trim() && openingReadingValue === null) {
      return Alert.alert('Invalid reading', 'Enter a valid nonnegative opening meter reading.');
    }
    if (hasStarted && openingReadingValue === null) {
      return Alert.alert(
        'Opening reading required',
        'Enter the meter value on the move-in date before registering a tenant who has already moved in.',
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
    setIsSubmitting(true);
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
        setUploadingDocument,
      );
      if (notice) {
        Alert.alert('Tenant registered', notice, [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        router.back();
      }
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : 'Could not register this tenant.');
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
        <View style={styles.roomBanner}>
          <Text style={styles.roomBannerName}>{room.roomName}</Text>
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

        <Text style={styles.label}>Opening meter reading (kWh)</Text>
        {startDate && toIsoDate(startDate) <= toIsoDate(new Date()) ? (
          <>
            <TextInput
              accessibilityLabel="Opening meter reading in kilowatt-hours"
              style={styles.input}
              value={openingMeterReading}
              onChangeText={(text) => setOpeningMeterReading(sanitizeMeterReadingInput(text))}
              keyboardType="decimal-pad"
              placeholder="Value shown on the meter at move-in"
              placeholderTextColor="#8A94A6"
            />
            <Text style={styles.readingHelper}>
              This reading is saved on the move-in date and prevents electricity used by a previous
              tenant from being billed to this tenancy.
            </Text>
          </>
        ) : (
          <Text style={styles.readingHelper}>
            For a future move-in, record the opening reading on the move-in date before billing
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
          isUploading={uploadingDocument === 'id'}
          disabled={isSubmitting}
        />

        <ImageField
          label="Contract"
          image={contractImage}
          onChange={setContractImage}
          placeholder="Tap to attach a photo of the signed contract"
          isUploading={uploadingDocument === 'agreement'}
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