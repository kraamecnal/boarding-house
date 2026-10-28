import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DashboardColors } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseClient } from '@/utils/supabase';

type ChargeType = 'water' | 'wifi' | 'trash' | 'electricity';
type ChargeValues = Record<ChargeType, string>;
type ChargeErrors = Partial<Record<ChargeType, string>>;

const EMPTY_VALUES: ChargeValues = {
  water: '',
  wifi: '',
  trash: '',
  electricity: '',
};

const CHARGES: {
  key: ChargeType;
  label: string;
  unit: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'water', label: 'Water charge', unit: '₱', icon: 'water-outline' },
  { key: 'wifi', label: 'Wi-Fi charge', unit: '₱', icon: 'wifi-outline' },
  { key: 'trash', label: 'Trash charge', unit: '₱', icon: 'trash-outline' },
  { key: 'electricity', label: 'Electricity rate', unit: '₱/kWh', icon: 'flash-outline' },
];

const DECIMAL_AMOUNT = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;

function isChargeType(value: unknown): value is ChargeType {
  return value === 'water' || value === 'wifi' || value === 'trash' || value === 'electricity';
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function BillingChargesScreen() {
  const { session } = useAuth();
  const ownerId = session?.user.id;
  const [values, setValues] = useState<ChargeValues>(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<ChargeErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [savedValueCount, setSavedValueCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveInProgress = useRef(false);

  useEffect(() => {
    let isCurrent = true;

    const loadCharges = async () => {
      setIsLoading(true);
      setLoadError(null);
      setSaveError(null);
      setSaveSuccess(false);

      if (!ownerId) {
        setLoadError('Your signed-in owner account could not be identified. Please sign in again.');
        setIsLoading(false);
        return;
      }

      try {
        const { data, error } = await getSupabaseClient()
          .from('owner_default_charges')
          .select('item_type, unit_price')
          .eq('owner_id', ownerId);

        if (error) throw error;

        const nextValues = { ...EMPTY_VALUES };
        let savedCount = 0;

        for (const row of data ?? []) {
          if (!isChargeType(row.item_type)) continue;
          if (row.unit_price === null || row.unit_price === undefined) {
            throw new Error(`The saved ${row.item_type} charge has no price.`);
          }

          nextValues[row.item_type] = String(row.unit_price);
          savedCount += 1;
        }

        if (!isCurrent) return;
        setValues(nextValues);
        setFieldErrors({});
        setSavedValueCount(savedCount);
      } catch (error: unknown) {
        if (!isCurrent) return;
        setLoadError(getErrorMessage(error, 'Could not load your saved charges. Please try again.'));
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    void loadCharges();

    return () => {
      isCurrent = false;
    };
  }, [loadAttempt, ownerId]);

  const updateValue = useCallback((key: ChargeType, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setSaveError(null);
    setSaveSuccess(false);
  }, []);

  const saveChanges = async () => {
    if (saveInProgress.current || isLoading || !ownerId) return;

    setSaveError(null);
    setSaveSuccess(false);

    const errors: ChargeErrors = {};
    for (const charge of CHARGES) {
      const value = values[charge.key].trim();
      if (!value) {
        errors[charge.key] = 'Enter a value for this charge.';
      } else if (value.startsWith('-')) {
        errors[charge.key] = 'Charge amounts cannot be negative.';
      } else if (!DECIMAL_AMOUNT.test(value)) {
        errors[charge.key] = 'Enter a valid amount with no more than 2 decimal places.';
      }
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    saveInProgress.current = true;
    setIsSaving(true);

    try {
      const rows = CHARGES.map(({ key }) => ({
        owner_id: ownerId,
        item_type: key,
        unit_price: values[key].trim(),
      }));

      const { error } = await getSupabaseClient()
        .from('owner_default_charges')
        .upsert(rows, { onConflict: 'owner_id,item_type' });

      if (error) throw error;

      setValues((current) => ({
        water: current.water.trim(),
        wifi: current.wifi.trim(),
        trash: current.trash.trim(),
        electricity: current.electricity.trim(),
      }));
      setSavedValueCount(CHARGES.length);
      setSaveSuccess(true);
    } catch (error: unknown) {
      setSaveError(getErrorMessage(error, 'Could not save your charges. Your values are still here.'));
    } finally {
      saveInProgress.current = false;
      setIsSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <Ionicons color={DashboardColors.primary} name="receipt-outline" size={24} />
        </View>
        <Text style={styles.description}>
          Set the default charges shared across all of your boarding houses.
        </Text>
      </View>

      {isLoading ? (
        <View accessibilityLiveRegion="polite" style={styles.stateCard}>
          <ActivityIndicator color={DashboardColors.primary} size="large" />
          <Text style={styles.stateText}>Loading your saved charges…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.stateCard}>
          <Ionicons color="#B42318" name="alert-circle-outline" size={28} />
          <Text accessibilityLiveRegion="polite" style={styles.errorText}>
            {loadError}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setLoadAttempt((attempt) => attempt + 1)}
            style={styles.retryButton}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {savedValueCount < CHARGES.length && (
            <View style={styles.setupNotice}>
              <Ionicons color={DashboardColors.primary} name="information-circle-outline" size={20} />
              <Text style={styles.setupText}>
                {savedValueCount === 0
                  ? 'No defaults are saved yet. Enter all four values to finish setup. A blank field is not treated as zero.'
                  : 'Some defaults are not saved yet. Complete each blank field; a blank value is not treated as zero.'}
              </Text>
            </View>
          )}

          <View style={styles.formCard}>
            {CHARGES.map((charge) => (
              <ChargeInput
                disabled={isSaving}
                error={fieldErrors[charge.key]}
                icon={charge.icon}
                key={charge.key}
                label={charge.label}
                onChangeText={(text) => updateValue(charge.key, text)}
                unit={charge.unit}
                value={values[charge.key]}
              />
            ))}

            <View style={styles.infoNote}>
              <Ionicons color={DashboardColors.primary} name="shield-checkmark-outline" size={18} />
              <Text style={styles.infoText}>
                Water, Wi-Fi, and trash defaults are copied into newly generated bills. Existing
                bills keep their original amounts. The current bill-generation function excludes
                electricity, so this saved rate is not yet applied by that function.
              </Text>
            </View>

            {saveError && (
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                {saveError}
              </Text>
            )}
            {saveSuccess && (
              <Text accessibilityLiveRegion="polite" style={styles.successText}>
                Your default charges have been saved.
              </Text>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => void saveChanges()}
              style={({ pressed }) => [
                styles.saveButton,
                (pressed || isSaving) && styles.saveButtonPressed,
              ]}>
              {isSaving ? (
                <View style={styles.savingContent}>
                  <ActivityIndicator color={DashboardColors.white} size="small" />
                  <Text style={styles.saveLabel}>Saving…</Text>
                </View>
              ) : (
                <Text style={styles.saveLabel}>Save changes</Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function ChargeInput({
  disabled,
  error,
  icon,
  label,
  onChangeText,
  unit,
  value,
}: {
  disabled: boolean;
  error?: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onChangeText: (value: string) => void;
  unit: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputContainer, error && styles.inputContainerError]}>
        <View style={styles.fieldIcon}>
          <Ionicons color={DashboardColors.primary} name={icon} size={19} />
        </View>
        <TextInput
          accessibilityLabel={`${label} in ${unit}`}
          editable={!disabled}
          keyboardType="decimal-pad"
          onChangeText={onChangeText}
          placeholder="0.00"
          placeholderTextColor={DashboardColors.neutral}
          selectTextOnFocus
          style={styles.input}
          value={value}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
      {error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: 18,
    padding: 20,
    paddingBottom: 36,
    backgroundColor: '#F8FAFC',
  },
  intro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  introIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: DashboardColors.light,
  },
  description: {
    flex: 1,
    color: DashboardColors.neutral,
    fontSize: 15,
    lineHeight: 22,
  },
  stateCard: {
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 22,
    borderWidth: 1,
    borderColor: DashboardColors.light,
    borderRadius: 18,
    backgroundColor: DashboardColors.white,
  },
  stateText: {
    color: DashboardColors.neutral,
    fontSize: 15,
  },
  setupNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: DashboardColors.pale,
  },
  setupText: {
    flex: 1,
    color: DashboardColors.dark,
    fontSize: 13,
    lineHeight: 19,
  },
  formCard: {
    gap: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: DashboardColors.light,
    borderRadius: 18,
    backgroundColor: DashboardColors.white,
    shadowColor: DashboardColors.dark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    color: DashboardColors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  inputContainer: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: DashboardColors.white,
  },
  inputContainerError: {
    borderColor: '#B42318',
  },
  fieldIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: DashboardColors.pale,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    color: DashboardColors.text,
    fontSize: 16,
  },
  unit: {
    color: DashboardColors.neutral,
    fontSize: 14,
    fontWeight: '600',
  },
  fieldError: {
    color: '#B42318',
    fontSize: 12,
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 13,
    borderRadius: 12,
    backgroundColor: DashboardColors.pale,
  },
  infoText: {
    flex: 1,
    color: DashboardColors.dark,
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: {
    color: '#B42318',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  successText: {
    color: '#067647',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  savingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  retryButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: DashboardColors.primary,
  },
  retryLabel: {
    color: DashboardColors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  saveButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: DashboardColors.primary,
  },
  saveButtonPressed: {
    opacity: 0.78,
  },
  saveLabel: {
    color: DashboardColors.white,
    fontSize: 16,
    fontWeight: '700',
  },
});
