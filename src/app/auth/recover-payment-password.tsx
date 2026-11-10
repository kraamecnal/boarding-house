import { Ionicons } from '@expo/vector-icons';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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

import { DashboardColors } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';

const RESEND_COOLDOWN_SECONDS = 60;
const MIN_PASSWORD_LENGTH = 8;

type RecoveryStep = 'email' | 'verify' | 'password' | 'success';
type BusyAction = 'send' | 'verify' | 'update' | null;

function createRecoveryClient(): SupabaseClient {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase is not configured.');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function RecoverPaymentPasswordScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const recoveryClient = useRef<SupabaseClient | null>(null);
  const verifiedUserId = useRef<string | null>(null);
  const actionLock = useRef(false);
  const [step, setStep] = useState<RecoveryStep>('email');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendSeconds]);

  const requestRecoveryCode = async () => {
    const normalizedEmail = email.trim();
    if (!isValidEmail(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (actionLock.current) return;

    setError(null);
    setNotice(null);
    actionLock.current = true;
    setBusyAction('send');
    try {
      const client = createRecoveryClient();
      recoveryClient.current = client;
      verifiedUserId.current = null;
      const { error: requestError } = await client.auth.resetPasswordForEmail(normalizedEmail);
      if (requestError) throw requestError;

      setRecoveryEmail(normalizedEmail);
      setOtp('');
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
      setNotice('If an account exists for this address, a recovery code has been sent.');
      setStep('verify');
    } catch {
      setError('We could not send a recovery code. Check your connection and try again later.');
    } finally {
      actionLock.current = false;
      setBusyAction(null);
    }
  };

  const verifyRecoveryCode = async () => {
    if (actionLock.current || !/^\d{6}$/.test(otp)) return;
    if (!session?.user.id) {
      setError('Your sign-in session has expired. Sign in again and request a new code.');
      return;
    }

    const client = recoveryClient.current;
    if (!client) {
      setError('Request a new recovery code before verifying.');
      return;
    }

    setError(null);
    setNotice(null);
    actionLock.current = true;
    setBusyAction('verify');
    try {
      const { data, error: verifyError } = await client.auth.verifyOtp({
        email: recoveryEmail,
        token: otp,
        type: 'recovery',
      });
      if (verifyError) throw verifyError;
      if (!data.session || data.session.user.id !== session.user.id) {
        recoveryClient.current = null;
        verifiedUserId.current = null;
        setError('This code could not be verified for the signed-in account. Check the email and try again.');
        return;
      }

      verifiedUserId.current = data.session.user.id;
      setStep('password');
    } catch {
      setError('That code is invalid or expired. Check it or request a new code.');
    } finally {
      actionLock.current = false;
      setBusyAction(null);
    }
  };

  const updatePassword = async () => {
    if (actionLock.current) return;
    if (!newPassword || !confirmPassword) {
      setError('Enter and confirm your new password.');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (!session?.user.id || verifiedUserId.current !== session.user.id) {
      setError('Verify your recovery code before updating the password.');
      return;
    }

    const client = recoveryClient.current;
    if (!client) {
      setError('Your recovery verification expired. Request a new code and try again.');
      return;
    }

    setError(null);
    actionLock.current = true;
    setBusyAction('update');
    try {
      const { error: updateError } = await client.auth.updateUser({
        password: newPassword,
        data: { payment_password_set: true },
      });
      if (updateError) throw updateError;

      recoveryClient.current = null;
      verifiedUserId.current = null;
      setNewPassword('');
      setConfirmPassword('');
      setStep('success');
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'We could not update your password. Try again.',
      );
    } finally {
      actionLock.current = false;
      setBusyAction(null);
    }
  };

  const changeEmail = () => {
    recoveryClient.current = null;
    verifiedUserId.current = null;
    setRecoveryEmail('');
    setOtp('');
    setNotice(null);
    setError(null);
    setStep('email');
  };

  const passwordsMismatch =
    Boolean(newPassword && confirmPassword) && newPassword !== confirmPassword;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          {step === 'email' && (
            <>
              <Text style={styles.title}>Forgot password?</Text>
              <Text style={styles.subtitle}>
                Enter your registered email address to receive a password reset code.
              </Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={busyAction === null}
                keyboardType="email-address"
                onChangeText={(value) => {
                  setEmail(value);
                  setError(null);
                }}
                placeholder="Email address"
                placeholderTextColor="#98A2B3"
                returnKeyType="go"
                style={styles.input}
                textContentType="emailAddress"
                value={email}
              />
              <PrimaryButton
                disabled={!isValidEmail(email.trim()) || busyAction !== null}
                loading={busyAction === 'send'}
                onPress={() => void requestRecoveryCode()}>
                Send recovery code
              </PrimaryButton>
            </>
          )}

          {step === 'verify' && (
            <>
              <Text style={styles.title}>Verify your email</Text>
              <Text style={styles.subtitle}>
                Enter the verification code sent to your email address.
              </Text>
              <Text style={styles.emailUsed}>{recoveryEmail}</Text>
              <TextInput
                accessibilityLabel="Six-digit verification code"
                autoComplete="one-time-code"
                autoCorrect={false}
                editable={busyAction === null}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={(value) => {
                  setOtp(value.replace(/\D/g, '').slice(0, 6));
                  setError(null);
                }}
                onSubmitEditing={() => void verifyRecoveryCode()}
                placeholder="6-digit code"
                placeholderTextColor="#98A2B3"
                returnKeyType="go"
                style={[styles.input, styles.otpInput]}
                textContentType="oneTimeCode"
                value={otp}
              />
              <Pressable
                accessibilityRole="button"
                disabled={resendSeconds > 0 || busyAction !== null}
                onPress={() => void requestRecoveryCode()}
                style={styles.textAction}>
                <Text
                  style={[
                    styles.textActionLabel,
                    (resendSeconds > 0 || busyAction !== null) && styles.disabledLabel,
                  ]}>
                  {resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : 'Resend code'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busyAction !== null}
                onPress={changeEmail}
                style={styles.textAction}>
                <Text style={styles.textActionLabel}>Use a different email</Text>
              </Pressable>
              <PrimaryButton
                disabled={!/^\d{6}$/.test(otp) || busyAction !== null}
                loading={busyAction === 'verify'}
                onPress={() => void verifyRecoveryCode()}>
                Verify code
              </PrimaryButton>
            </>
          )}

          {step === 'password' && (
            <>
              <Text style={styles.title}>Create a new password</Text>
              <Text style={styles.subtitle}>
                Enter your new password and confirm it below.
              </Text>
              <TextInput
                accessibilityLabel="New password"
                autoCapitalize="none"
                autoComplete="new-password"
                autoCorrect={false}
                editable={busyAction === null}
                onChangeText={(value) => {
                  setNewPassword(value);
                  setError(null);
                }}
                placeholder="New password"
                placeholderTextColor="#98A2B3"
                secureTextEntry={!showPasswords}
                style={styles.input}
                textContentType="newPassword"
                value={newPassword}
              />
              <TextInput
                accessibilityLabel="Confirm new password"
                autoCapitalize="none"
                autoComplete="new-password"
                autoCorrect={false}
                editable={busyAction === null}
                onChangeText={(value) => {
                  setConfirmPassword(value);
                  setError(null);
                }}
                onSubmitEditing={() => void updatePassword()}
                placeholder="Confirm new password"
                placeholderTextColor="#98A2B3"
                secureTextEntry={!showPasswords}
                style={styles.input}
                textContentType="newPassword"
                value={confirmPassword}
              />
              <Pressable
                accessibilityLabel={showPasswords ? 'Hide passwords' : 'Show passwords'}
                accessibilityRole="button"
                disabled={busyAction !== null}
                onPress={() => setShowPasswords((shown) => !shown)}
                style={styles.showPassword}>
                <Ionicons
                  color={DashboardColors.neutral}
                  name={showPasswords ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                />
                <Text style={styles.textActionLabel}>
                  {showPasswords ? 'Hide passwords' : 'Show passwords'}
                </Text>
              </Pressable>
              {newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH && (
                <Text style={styles.inlineError}>
                  Use at least {MIN_PASSWORD_LENGTH} characters.
                </Text>
              )}
              {passwordsMismatch && (
                <Text style={styles.inlineError}>The passwords do not match.</Text>
              )}
              <PrimaryButton
                disabled={
                  !newPassword ||
                  !confirmPassword ||
                  passwordsMismatch ||
                  busyAction !== null
                }
                loading={busyAction === 'update'}
                onPress={() => void updatePassword()}>
                Update password
              </PrimaryButton>
            </>
          )}

          {step === 'success' && (
            <>
              <Text style={styles.title}>Password successfully changed.</Text>
              <Text style={styles.subtitle}>
                Your new password can now be used to confirm bill payments.
              </Text>
              <PrimaryButton onPress={() => router.replace('/profile')}>
                Return to Profile
              </PrimaryButton>
            </>
          )}

          {notice && (
            <Text accessibilityLiveRegion="polite" style={styles.notice}>
              {notice}
            </Text>
          )}
          {error && (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {error}
            </Text>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PrimaryButton({
  children,
  disabled = false,
  loading = false,
  onPress,
}: {
  children: string;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.buttonDisabled]}>
      {loading ? (
        <ActivityIndicator color={DashboardColors.white} />
      ) : (
        <Text style={styles.buttonLabel}>{children}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: DashboardColors.white },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: 14,
  },
  title: {
    color: DashboardColors.dark,
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: DashboardColors.neutral,
    fontSize: 15,
    lineHeight: 22,
  },
  emailUsed: {
    color: DashboardColors.dark,
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    borderRadius: 11,
    color: DashboardColors.text,
    fontSize: 15,
  },
  otpInput: {
    textAlign: 'center',
    fontSize: 22,
    letterSpacing: 8,
  },
  textAction: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  textActionLabel: {
    color: DashboardColors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  disabledLabel: { color: DashboardColors.neutral },
  showPassword: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    paddingVertical: 4,
  },
  button: {
    minHeight: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: DashboardColors.primary,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: {
    color: DashboardColors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  notice: {
    color: '#067647',
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    lineHeight: 20,
  },
  inlineError: {
    color: '#B42318',
    fontSize: 13,
  },
});
