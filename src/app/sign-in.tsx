import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
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
  const { initializationError, requestMagicLink } = useAuth();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const submissionInProgress = useRef(false);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setFormError(null);
    setSentTo(null);
  };

  const handleSubmit = async () => {
    if (submissionInProgress.current) return;
    setFormError(null);
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setFormError('Enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFormError('Enter a valid email address.');
      return;
    }

    submissionInProgress.current = true;
    setIsSubmitting(true);
    try {
      await requestMagicLink(normalizedEmail, mode);
      setSentTo(normalizedEmail);
    } catch (error: unknown) {
      setFormError(getReadableAuthError(error, mode));
    } finally {
      submissionInProgress.current = false;
      setIsSubmitting(false);
    }
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
              {sentTo
                ? 'Check your email'
                : mode === 'sign-in'
                  ? 'Welcome back'
                  : 'Create your account'}
            </Text>
            <Text style={styles.subtitle}>
              {sentTo
                ? `A secure ${mode === 'sign-in' ? 'sign-in' : 'account confirmation'} link has been requested for ${sentTo}. Open it on this device to continue.`
                : mode === 'sign-in'
                  ? "Enter your email and we'll send you a secure sign-in link."
                  : 'Get started managing your boarding house.'}
            </Text>

            {!sentTo && (
              <>
                <View style={styles.modeSwitch} accessibilityRole="tablist">
                  <ModeButton
                    label="Sign in"
                    selected={mode === 'sign-in'}
                    disabled={isSubmitting}
                    onPress={() => switchMode('sign-in')}
                  />
                  <ModeButton
                    label="Sign up"
                    selected={mode === 'sign-up'}
                    disabled={isSubmitting}
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
                    editable={!isSubmitting}
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

            {sentTo ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setSentTo(null)}
                style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Use a different email</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting || !isSupabaseConfigured}
                onPress={handleSubmit}
                style={({ pressed }) => [
                  styles.submitButton,
                  pressed && styles.submitButtonPressed,
                  (isSubmitting || !isSupabaseConfigured) && styles.submitButtonDisabled,
                ]}>
                {isSubmitting ? (
                  <ActivityIndicator color={DashboardColors.white} />
                ) : (
                  <Text style={styles.submitText}>
                    {mode === 'sign-in' ? 'Send magic link' : 'Create account'}
                  </Text>
                )}
              </Pressable>
            )}

            <Text style={styles.securityNote}>
              Sign in securely with a one-time email link. No password needed.
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

function getReadableAuthError(error: unknown, mode: AuthMode): string {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();

  if (normalized.includes('redirect') || normalized.includes('url')) {
    return message || 'The sign-in redirect is not configured. Check your app redirect settings.';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Too many email requests. Wait a little while, then try again.';
  }
  if (normalized.includes('fetch') || normalized.includes('network')) {
    return 'Unable to reach the sign-in service. Check your internet connection and try again.';
  }
  if (normalized.includes('expired') || normalized.includes('invalid')) {
    return 'This email link is invalid or expired. Request a new link and try again.';
  }
  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return mode === 'sign-up'
      ? 'An account may already exist for this email. Try the Sign in tab.'
      : 'Unable to send a sign-in link for this email. Check the address and try again.';
  }
  return message || 'We could not request an email link. Please try again.';
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
