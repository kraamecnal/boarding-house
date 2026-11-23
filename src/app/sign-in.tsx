import { Ionicons } from '@expo/vector-icons';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { DashboardColors } from '@/constants/theme';
import { useAuth, type AuthMode } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/utils/supabase';

export default function SignInScreen() {
  const { initializationError, requestEmailOtp, verifyEmailOtp } = useAuth();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [resendFeedback, setResendFeedback] = useState(false);
  const sendInProgress = useRef(false);
  const verifyInProgress = useRef(false);

  useEffect(() => {
    if (!pendingEmail || resendSeconds === 0) return;
    const timer = setTimeout(() => setResendSeconds((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [pendingEmail, resendSeconds]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setFormError(null);
    setResendFeedback(false);
  };

  const sendCode = async (targetEmail: string, isResend = false) => {
    if (sendInProgress.current || (isResend && resendSeconds > 0)) return;
    setFormError(null);
    if (isResend) setResendFeedback(false);
    sendInProgress.current = true;
    setIsSending(true);
    try {
      await requestEmailOtp(targetEmail, mode);
      if (!isResend) {
        setPendingEmail(targetEmail);
        setCode('');
      } else {
        setResendFeedback(true);
      }
      setResendSeconds(60);
    } catch (error: unknown) {
      setFormError(getReadableAuthError(error, 'request', mode));
    } finally {
      sendInProgress.current = false;
      setIsSending(false);
    }
  };

  const handleSubmit = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setFormError('Enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFormError('Enter a valid email address.');
      return;
    }
    await sendCode(normalizedEmail);
  };

  const handleVerify = async () => {
    if (!pendingEmail || code.length !== 6 || verifyInProgress.current) return;
    setFormError(null);
    verifyInProgress.current = true;
    setIsVerifying(true);
    try {
      await verifyEmailOtp(pendingEmail, code);
    } catch (error: unknown) {
      setFormError(getReadableAuthError(error, 'verification', mode));
    } finally {
      verifyInProgress.current = false;
      setIsVerifying(false);
    }
  };

  const handleBackToEmail = () => {
    setPendingEmail(null);
    setCode('');
    setFormError(null);
    setResendFeedback(false);
    setResendSeconds(0);
  };

  const configurationMessage = !isSupabaseConfigured
    ? 'Connect Supabase by setting EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
    : initializationError;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <Ionicons name="home" size={27} color={DashboardColors.white} />
            </View>
            <Text style={styles.brandName}>InKeeper</Text>
            <Text style={styles.tagline}>Your boarding house, in good hands.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>
              {pendingEmail
                ? 'Verify your email'
                : mode === 'sign-in'
                  ? 'Welcome back'
                  : 'Create your account'}
            </Text>
            <Text style={styles.subtitle}>
              {pendingEmail
                ? mode === 'sign-in'
                  ? `If an account exists for ${pendingEmail}, a six-digit code has been sent. Enter it below to continue.`
                  : `We've sent a six-digit verification code to ${pendingEmail}. Enter it below to continue.`
                : mode === 'sign-in'
                  ? "Enter your email and we'll send you a verification code."
                  : 'Get started managing your boarding house.'}
            </Text>

            {!pendingEmail ? (
              <>
                <View style={styles.modeSwitch} accessibilityRole="tablist">
                  <ModeButton
                    label="Sign in"
                    selected={mode === 'sign-in'}
                    disabled={isSending}
                    onPress={() => switchMode('sign-in')}
                  />
                  <ModeButton
                    label="Sign up"
                    selected={mode === 'sign-up'}
                    disabled={isSending}
                    onPress={() => switchMode('sign-up')}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Email address</Text>
                  <TextInput
                    accessibilityLabel="Email address"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    editable={!isSending}
                    keyboardType="email-address"
                    onChangeText={(value) => {
                      setEmail(value);
                      setFormError(null);
                    }}
                    onSubmitEditing={handleSubmit}
                    placeholder="you@example.com"
                    placeholderTextColor={DashboardColors.neutral}
                    returnKeyType="send"
                    style={styles.input}
                    value={email}
                  />
                </View>
              </>
            ) : (
              <View style={styles.field}>
                <Text style={styles.label}>Six-digit verification code</Text>
                <TextInput
                  accessibilityLabel="Six-digit verification code"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={(value) => {
                    setCode(value.replace(/\D/g, '').slice(0, 6));
                    setFormError(null);
                  }}
                  placeholder="000000"
                  placeholderTextColor={DashboardColors.neutral}
                  returnKeyType="done"
                  onSubmitEditing={handleVerify}
                  style={[styles.input, styles.codeInput]}
                  textContentType="oneTimeCode"
                  value={code}
                />
              </View>
            )}

            {configurationMessage && (
              <View style={styles.notice}>
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={DashboardColors.dark}
                />
                <Text style={styles.noticeText}>{configurationMessage}</Text>
              </View>
            )}

            {formError && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {formError}
              </Text>
            )}

            {pendingEmail ? (
              <>
                {resendFeedback && (
                  <Text accessibilityLiveRegion="polite" style={styles.resendFeedback}>
                    A new code has been requested.
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={isVerifying || isSending || code.length !== 6 || !isSupabaseConfigured}
                  onPress={handleVerify}
                  style={({ pressed }) => [
                    styles.submitButton,
                    pressed && styles.submitButtonPressed,
                    (isVerifying ||
                      isSending ||
                      code.length !== 6 ||
                      !isSupabaseConfigured) &&
                      styles.submitButtonDisabled,
                  ]}>
                  {isVerifying ? (
                    <ActivityIndicator color={DashboardColors.white} />
                  ) : (
                    <Text style={styles.submitText}>Verify code</Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSending || resendSeconds > 0 || !isSupabaseConfigured}
                  onPress={() => void sendCode(pendingEmail, true)}
                  style={styles.linkButton}>
                  <Text
                    style={[
                      styles.linkButtonText,
                      (isSending || resendSeconds > 0 || !isSupabaseConfigured) &&
                        styles.linkButtonDisabled,
                    ]}>
                    {isSending
                      ? 'Sending code...'
                      : resendSeconds > 0
                        ? `Resend code in 0:${String(resendSeconds).padStart(2, '0')}`
                        : 'Resend code'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSending || isVerifying}
                  onPress={handleBackToEmail}
                  style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Back to email</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={isSending || !isSupabaseConfigured}
                onPress={handleSubmit}
                style={({ pressed }) => [
                  styles.submitButton,
                  pressed && styles.submitButtonPressed,
                  (isSending || !isSupabaseConfigured) && styles.submitButtonDisabled,
                ]}>
                {isSending ? (
                  <ActivityIndicator color={DashboardColors.white} />
                ) : (
                  <Text style={styles.submitText}>
                    {mode === 'sign-in' ? 'Send verification code' : 'Create account'}
                  </Text>
                )}
              </Pressable>
            )}

            <Text style={styles.securityNote}>
              Sign in securely with a one-time email code. No password needed.
            </Text>
          </View>

          <Text style={styles.footer}>Simple tools for better tenant care.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ModeButton({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.modeButton, selected && styles.modeButtonSelected]}>
      <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function getReadableAuthError(
  error: unknown,
  action: 'request' | 'verification',
  mode: AuthMode,
): string {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code.toLowerCase()
      : '';

  if (
    code.includes('rate_limit') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many') ||
    normalized.includes('security purposes')
  ) {
    return 'Too many code requests. Wait a little while before requesting another code.';
  }
  if (normalized.includes('fetch') || normalized.includes('network')) {
    return 'Unable to reach the sign-in service. Check your internet connection and try again.';
  }
  if (
    mode === 'sign-in' &&
    (code === 'user_not_found' ||
      code === 'signup_disabled' ||
      normalized.includes('user not found') ||
      normalized.includes('account not found') ||
      normalized.includes('account does not exist') ||
      normalized.includes('signups not allowed'))
  ) {
    return 'Account does not exist, sign up first.';
  }
  if (action === 'verification' && (normalized.includes('expired') || normalized.includes('invalid'))) {
    return 'That code is incorrect or expired. Check it or request a new one.';
  }
  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return mode === 'sign-up'
      ? 'An account may already exist for this email. Try the Sign in tab.'
      : 'Unable to send a code for this email. Check the address and try again.';
  }
  if (action === 'verification') return 'We could not verify that code. Please try again.';
  return 'We could not send a verification code. Please try again.';
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: DashboardColors.pale,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  brand: {
    alignItems: 'center',
    marginBottom: 28,
  },
  brandMark: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: DashboardColors.primary,
    marginBottom: 12,
  },
  brandName: {
    color: DashboardColors.text,
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  tagline: {
    color: DashboardColors.neutral,
    fontSize: 14,
    marginTop: 5,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    padding: 24,
    borderRadius: 24,
    backgroundColor: DashboardColors.white,
    borderWidth: 1,
    borderColor: DashboardColors.light,
    shadowColor: DashboardColors.dark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: 3,
  },
  title: {
    color: DashboardColors.text,
    fontSize: 25,
    fontWeight: '700',
  },
  subtitle: {
    color: DashboardColors.neutral,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 7,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: DashboardColors.pale,
    padding: 4,
    borderRadius: 12,
    marginTop: 24,
    marginBottom: 22,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    borderRadius: 9,
  },
  modeButtonSelected: {
    backgroundColor: DashboardColors.primary,
  },
  modeText: {
    color: DashboardColors.neutral,
    fontSize: 14,
    fontWeight: '600',
  },
  modeTextSelected: {
    color: DashboardColors.white,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    color: DashboardColors.dark,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 11,
    backgroundColor: DashboardColors.white,
    color: DashboardColors.text,
    fontSize: 15,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 10,
    textAlign: 'center',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    marginBottom: 14,
    borderRadius: 10,
    backgroundColor: DashboardColors.light,
  },
  noticeText: {
    flex: 1,
    color: DashboardColors.dark,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  submitButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: DashboardColors.primary,
    marginTop: 3,
  },
  submitButtonPressed: {
    backgroundColor: DashboardColors.dark,
  },
  submitButtonDisabled: {
    opacity: 0.55,
  },
  submitText: {
    color: DashboardColors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: DashboardColors.border,
    borderRadius: 12,
    marginTop: 4,
  },
  secondaryButtonText: {
    color: DashboardColors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  linkButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButtonText: {
    color: DashboardColors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  linkButtonDisabled: {
    color: DashboardColors.neutral,
  },
  resendFeedback: {
    color: DashboardColors.dark,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
  },
  securityNote: {
    color: DashboardColors.neutral,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 18,
  },
  footer: {
    color: DashboardColors.neutral,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
  },
});
