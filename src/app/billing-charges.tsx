import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DashboardColors } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useOwnerCharges, type OwnerChargeInput } from '@/contexts/OwnerChargesContext';
import { CHARGES, type ChargeType } from '@/data/charges';

type ChargeValues = Record<ChargeType, string>;
type ChargeErrors = Partial<Record<ChargeType, string>>;

const DECIMAL_AMOUNT = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;
const MIN_PASSWORD_LENGTH = 8;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function BillingChargesScreen() {
  const router = useRouter();
  const { hasPaymentPassword, setPaymentPassword, signOut } = useAuth();
  const { charges, hasAllCharges, saveCharges } = useOwnerCharges();
  const needsSetup = !hasAllCharges || !hasPaymentPassword;
  const [values, setValues] = useState<ChargeValues>(() => ({
    water: charges.water === undefined ? '' : String(charges.water),
    wifi: charges.wifi === undefined ? '' : String(charges.wifi),
    trash: charges.trash === undefined ? '' : String(charges.trash),
    electricity: charges.electricity === undefined ? '' : String(charges.electricity),
  }));
  const [fieldErrors, setFieldErrors] = useState<ChargeErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const saveInProgress = useRef(false);
  const savedValueCount = CHARGES.filter(({ key }) => charges[key] !== undefined).length;

  const updateValue = useCallback((key: ChargeType, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setSaveError(null);
    setSaveSuccess(false);
  }, []);

  const saveChanges = async () => {
    if (saveInProgress.current) return;

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

    if (!hasPaymentPassword && password.length < MIN_PASSWORD_LENGTH) {
      setSaveError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the payment password.`);
      return;
    }
    if (!hasPaymentPassword && password !== confirmPassword) {
      setSaveError('The payment passwords do not match.');
      return;
    }

    saveInProgress.current = true;
    setIsSaving(true);

    let chargesSaved = false;
    try {
      const input = Object.fromEntries(
        CHARGES.map(({ key }) => [key, Number(values[key].trim())]),
      ) as OwnerChargeInput;
      await saveCharges(input);
      chargesSaved = true;

      setValues((current) => ({
        water: current.water.trim(),
        wifi: current.wifi.trim(),
        trash: current.trash.trim(),
        electricity: current.electricity.trim(),
      }));
      if (!hasPaymentPassword) await setPaymentPassword(password);
      setSaveSuccess(true);
      if (needsSetup) router.replace('/(tabs)');
    } catch (error: unknown) {
      const fallback = 'Could not save your changes. Your values are still here.';
      const message = getErrorMessage(error, fallback);
      setSaveError(
        chargesSaved && !hasPaymentPassword
          ? `Your billing charges were saved, but the payment password could not be set. ${message}`
          : message,
      );
    } finally {
      saveInProgress.current = false;
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error: unknown) {
      setSaveError(getErrorMessage(error, 'Unable to sign out. Please try again.'));
      setIsSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={needsSetup ? ['top', 'bottom'] : ['bottom']}>
      <Stack.Screen
        options={{
          headerShown: !needsSetup,
          gestureEnabled: !needsSetup,
          title: 'Billing charges',
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.intro}>
            <View style={styles.introIcon}>
              <Ionicons color={DashboardColors.primary} name="receipt-outline" size={24} />
            </View>
            <View style={styles.introCopy}>
              {needsSetup && <Text style={styles.setupTitle}>Billing charges</Text>}
              <Text style={styles.description}>
                {needsSetup
                  ? 'Set your default billing charges and payment password to finish account setup.'
                  : 'Set the default charges shared across all of your boarding houses.'}
              </Text>
            </View>
          </View>

          {savedValueCount < CHARGES.length && (
            <View style={styles.setupNotice}>
              <Ionicons color={DashboardColors.primary} name="information-circle-outline" size={20} />
              <Text style={styles.setupText}>
                {savedValueCount === 0
                  ? 'Enter all four values to finish setup. A blank field is not treated as zero.'
                  : 'Complete each blank field; a blank value is not treated as zero.'}
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
                bills keep their original amounts. Newly generated bills use this electricity rate
                when valid meter readings are available.
              </Text>
            </View>
          </View>

          {!hasPaymentPassword && (
            <View style={styles.formCard}>
              <Text style={styles.sectionTitle}>Payment password</Text>
              <Text style={styles.sectionDescription}>
                Enter this password when marking a bill as paid. It is also your account password,
                so keep it private.
              </Text>
              <PasswordInput
                disabled={isSaving}
                label="New password"
                onChangeText={(text) => {
                  setPassword(text);
                  setSaveError(null);
                }}
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((shown) => !shown)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                value={password}
              />
              <PasswordInput
                disabled={isSaving}
                label="Confirm password"
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  setSaveError(null);
                }}
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((shown) => !shown)}
                showToggle={false}
                value={confirmPassword}
                onSubmitEditing={saveChanges}
              />
            </View>
          )}

          {saveError && (
            <Text accessibilityLiveRegion="polite" style={styles.errorText}>
              {saveError}
            </Text>
          )}
          {saveSuccess && (
            <Text accessibilityLiveRegion="polite" style={styles.successText}>
              Your billing charges have been saved.
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
              <Text style={styles.saveLabel}>
                {needsSetup ? 'Save and continue' : 'Save changes'}
              </Text>
            )}
          </Pressable>

          {needsSetup && (
            <Pressable
              accessibilityRole="button"
              disabled={isSigningOut || isSaving}
              onPress={() => void handleSignOut()}
              style={styles.signOutButton}>
              <Text style={styles.signOutLabel}>
                {isSigningOut ? 'Signing out…' : 'Sign out'}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PasswordInput({
  disabled,
  label,
  onChangeText,
  onSubmitEditing,
  onToggleShow,
  placeholder,
  showPassword,
  showToggle = true,
  value,
}: {
  disabled: boolean;
  label: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  onToggleShow: () => void;
  placeholder?: string;
  showPassword: boolean;
  showToggle?: boolean;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputContainer}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoComplete="new-password"
          autoCorrect={false}
          editable={!disabled}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={DashboardColors.neutral}
          returnKeyType={onSubmitEditing ? 'go' : 'next'}
          secureTextEntry={!showPassword}
          style={styles.input}
          value={value}
        />
        {showToggle && (
          <Pressable
            accessibilityLabel={showPassword ? 'Hide passwords' : 'Show passwords'}
            accessibilityRole="button"
            onPress={onToggleShow}
            hitSlop={8}
            style={styles.eyeButton}>
            <Ionicons
              color={DashboardColors.neutral}
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
            />
          </Pressable>
        )}
      </View>
    </View>
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
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
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
  introCopy: {
    flex: 1,
    gap: 3,
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
    color: DashboardColors.neutral,
    fontSize: 15,
    lineHeight: 22,
  },
  setupTitle: {
    color: DashboardColors.text,
    fontSize: 22,
    fontWeight: '700',
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
  sectionTitle: {
    color: DashboardColors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  sectionDescription: {
    color: DashboardColors.neutral,
    fontSize: 13,
    lineHeight: 19,
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
  eyeButton: { width: 42, height: 48, alignItems: 'center', justifyContent: 'center' },
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
  signOutButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutLabel: {
    color: DashboardColors.neutral,
    fontSize: 14,
    fontWeight: '600',
  },
});
