import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

const MIN_PASSWORD_LENGTH = 8;

function sanitizeMoney(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length === 0 ? whole : `${whole}.${rest.join('').slice(0, 2)}`;
}

/**
 * Mandatory first-time setup (fixed charges + payment password).
 * Opened with `?edit=1` from Profile, it becomes a plain "edit charges" screen.
 */
export default function SetupScreen() {
  const params = useLocalSearchParams<{ edit?: string }>();
  const isEdit = (Array.isArray(params.edit) ? params.edit[0] : params.edit) === '1';
  const router = useRouter();
  const { hasPaymentPassword, setPaymentPassword, signOut } = useAuth();
  const { charges, hasAllCharges, saveCharges } = useOwnerCharges();
  const needsPassword = !hasPaymentPassword;

  const [values, setValues] = useState<Record<ChargeType, string>>(
    () =>
      Object.fromEntries(
        CHARGES.map(({ key }) => [key, charges[key] === undefined ? '' : String(charges[key])]),
      ) as Record<ChargeType, string>,
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once everything is saved, leave the mandatory setup.
  useEffect(() => {
    if (!isEdit && hasAllCharges && hasPaymentPassword) router.replace('/(tabs)');
  }, [hasAllCharges, hasPaymentPassword, isEdit, router]);

  const handleSave = async () => {
    if (isSaving) return;

    const parsed = {} as OwnerChargeInput;
    for (const { key, label } of CHARGES) {
      const raw = values[key].trim();
      if (raw === '') {
        setError(`Enter the ${label.toLowerCase()}. Use 0 if you don't charge for it.`);
        return;
      }
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        setError(`${label} must be a valid amount.`);
        return;
      }
      parsed[key] = amount;
    }

    if (needsPassword) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the payment password.`);
        return;
      }
      if (password !== confirmPassword) {
        setError('The payment passwords do not match.');
        return;
      }
    }

    setError(null);
    setIsSaving(true);
    let chargesSaved = false;
    try {
      await saveCharges(parsed);
      chargesSaved = true;
      if (needsPassword) await setPaymentPassword(password);
      if (isEdit) router.back();
    } catch (caught: unknown) {
      const reason =
        caught instanceof Error && caught.name === 'AuthRetryableFetchError'
          ? "Couldn't reach the server. Check your connection and try again."
          : caught instanceof Error
            ? caught.message
            : 'Something went wrong. Try again.';
      setError(
        chargesSaved
          ? `Your charges were saved, but the payment password could not be set. ${reason}`
          : reason,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign out. Try again.');
      setIsSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={isEdit ? ['bottom'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: isEdit, gestureEnabled: isEdit, title: 'Fixed charges' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!isEdit && (
            <View style={styles.brand}>
              <View style={styles.brandMark}>
                <Ionicons name="receipt-outline" size={26} color={DashboardColors.white} />
              </View>
              <Text style={styles.title}>Set up your fixed charges</Text>
            </View>
          )}
          <Text style={styles.intro}>
            {isEdit
              ? 'Changes only apply to bills generated after you save. Existing bills stay as they are.'
              : 'These charges are added to every monthly bill. Complete this setup to start using the app. Enter 0 for any charge you don’t collect.'}
          </Text>

          <View style={styles.card}>
            {CHARGES.map(({ key, label, unit, period, icon }) => (
              <View key={key} style={styles.field}>
                <View style={styles.labelRow}>
                  <Ionicons name={icon} size={18} color={DashboardColors.primary} />
                  <Text style={styles.label}>{label}</Text>
                  <Text style={styles.period}>{period}</Text>
                </View>
                <View style={styles.inputWrap}>
                  <Text style={styles.unit}>{unit}</Text>
                  <TextInput
                    accessibilityLabel={label}
                    editable={!isSaving}
                    keyboardType="decimal-pad"
                    maxLength={10}
                    onChangeText={(text) => {
                      setValues((current) => ({ ...current, [key]: sanitizeMoney(text) }));
                      setError(null);
                    }}
                    placeholder="0.00"
                    placeholderTextColor={DashboardColors.neutral}
                    style={styles.input}
                    value={values[key]}
                  />
                </View>
              </View>
            ))}
          </View>

          {needsPassword && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Payment password</Text>
              <Text style={styles.sectionHint}>
                You’ll enter this each time you mark a bill as paid. It is also your account
                password, so keep it private.
              </Text>
              <View style={styles.field}>
                <Text style={styles.label}>New password</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    accessibilityLabel="New payment password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    autoCorrect={false}
                    editable={!isSaving}
                    onChangeText={(text) => {
                      setPassword(text);
                      setError(null);
                    }}
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    placeholderTextColor={DashboardColors.neutral}
                    secureTextEntry={!showPassword}
                    style={styles.input}
                    value={password}
                  />
                  <Pressable
                    accessibilityLabel={showPassword ? 'Hide passwords' : 'Show passwords'}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setShowPassword((shown) => !shown)}
                    style={styles.eyeButton}>
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={DashboardColors.neutral}
                    />
                  </Pressable>
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Confirm password</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    accessibilityLabel="Confirm payment password"
                    autoCapitalize="none"
                    autoComplete="new-password"
                    autoCorrect={false}
                    editable={!isSaving}
                    onChangeText={(text) => {
                      setConfirmPassword(text);
                      setError(null);
                    }}
                    onSubmitEditing={handleSave}
                    returnKeyType="go"
                    secureTextEntry={!showPassword}
                    style={styles.input}
                    value={confirmPassword}
                  />
                </View>
              </View>
            </View>
          )}

          {error && (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {error}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            disabled={isSaving}
            onPress={handleSave}
            style={({ pressed }) => [
              styles.saveButton,
              pressed && styles.saveButtonPressed,
              isSaving && styles.saveButtonDisabled,
            ]}>
            {isSaving ? (
              <ActivityIndicator color={DashboardColors.white} />
            ) : (
              <Text style={styles.saveText}>{isEdit ? 'Save changes' : 'Save and continue'}</Text>
            )}
          </Pressable>

          {!isEdit && (
            <Pressable
              accessibilityRole="button"
              disabled={isSigningOut || isSaving}
              onPress={handleSignOut}
              style={styles.signOut}>
              <Text style={styles.signOutText}>{isSigningOut ? 'Signing out…' : 'Sign out'}</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: DashboardColors.white },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: 20, gap: 16 },
  brand: { alignItems: 'center', gap: 12, marginTop: 8 },
  brandMark: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: DashboardColors.primary,
  },
  title: { color: DashboardColors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  intro: { color: DashboardColors.neutral, fontSize: 14, lineHeight: 21 },
  card: {
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: DashboardColors.light,
    borderRadius: 16,
    backgroundColor: DashboardColors.pale,
  },
  sectionTitle: { color: DashboardColors.dark, fontSize: 16, fontWeight: '700' },
  sectionHint: { color: DashboardColors.neutral, fontSize: 13, lineHeight: 19 },
  field: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, color: DashboardColors.dark, fontSize: 14, fontWeight: '600' },
  period: { color: DashboardColors.neutral, fontSize: 12 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    paddingLeft: 14,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 11,
    backgroundColor: DashboardColors.white,
  },
  unit: { color: DashboardColors.neutral, fontSize: 15, fontWeight: '600', marginRight: 6 },
  input: {
    flex: 1,
    minHeight: 48,
    paddingRight: 14,
    color: DashboardColors.text,
    fontSize: 15,
  },
  eyeButton: { width: 46, height: 48, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#B42318', fontSize: 13, lineHeight: 19 },
  saveButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: DashboardColors.primary,
  },
  saveButtonPressed: { backgroundColor: DashboardColors.dark },
  saveButtonDisabled: { opacity: 0.55 },
  saveText: { color: DashboardColors.white, fontSize: 15, fontWeight: '700' },
  signOut: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  signOutText: { color: DashboardColors.neutral, fontSize: 14, fontWeight: '600' },
});