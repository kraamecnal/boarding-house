import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
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

import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/utils/supabase';

type AuthMode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const { confirmed } = useLocalSearchParams<{ confirmed?: string }>();
  const { initializationError, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  useEffect(() => {
    if (confirmed === '1') {
      setFormMessage('Your email is confirmed. Sign in to continue.');
    }
  }, [confirmed]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setFormError(null);
    setFormMessage(null);
  };

  const handleSubmit = async () => {
    setFormError(null);
    setFormMessage(null);

    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setFormError('Enter your password.');
      return;
    }
    if (mode === 'sign-up' && password !== confirmPassword) {
      setFormError('The passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'sign-in') {
        await signIn(normalizedEmail, password);
      } else {
        const hasSession = await signUp(normalizedEmail, password);
        if (!hasSession) {
          setPassword('');
          setConfirmPassword('');
          setMode('sign-in');
          setFormMessage('Account created. Check your email to confirm your address, then sign in.');
        }
      }
    } catch (error: unknown) {
      setFormError(
        error instanceof Error ? error.message : 'We could not complete that request. Try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const configurationMessage = !isSupabaseConfigured
    ? 'Connect your Supabase project by setting EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
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
              <Ionicons name="home" size={27} color="#FFFFFF" />
            </View>
            <Text style={styles.brandName}>InKeeper</Text>
            <Text style={styles.tagline}>Your boarding house, in good hands.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>
              {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
            </Text>
            <Text style={styles.subtitle}>
              {mode === 'sign-in'
                ? 'Sign in to manage your boarding house.'
                : 'Get started managing your boarding house.'}
            </Text>

            <View style={styles.modeSwitch}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === 'sign-in' }}
                onPress={() => switchMode('sign-in')}
                style={[styles.modeButton, mode === 'sign-in' && styles.modeButtonSelected]}>
                <Text style={[styles.modeText, mode === 'sign-in' && styles.modeTextSelected]}>
                  Sign in
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === 'sign-up' }}
                onPress={() => switchMode('sign-up')}
                style={[styles.modeButton, mode === 'sign-up' && styles.modeButtonSelected]}>
                <Text style={[styles.modeText, mode === 'sign-up' && styles.modeTextSelected]}>
                  Sign up
                </Text>
              </Pressable>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Email address</Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#98A2B3"
                returnKeyType="next"
                style={styles.input}
                value={email}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordInputWrap}>
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  onChangeText={setPassword}
                  onSubmitEditing={mode === 'sign-in' ? handleSubmit : undefined}
                  placeholder="Enter your password"
                  placeholderTextColor="#98A2B3"
                  returnKeyType={mode === 'sign-in' ? 'go' : 'next'}
                  secureTextEntry={!showPassword}
                  style={styles.passwordInput}
                  value={password}
                />
                <Pressable
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setShowPassword((visible) => !visible)}
                  style={styles.visibilityButton}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color="#667085"
                  />
                </Pressable>
              </View>
            </View>

            {mode === 'sign-up' && (
              <View style={styles.field}>
                <Text style={styles.label}>Confirm password</Text>
                <TextInput
                  accessibilityLabel="Confirm password"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  onChangeText={setConfirmPassword}
                  onSubmitEditing={handleSubmit}
                  placeholder="Re-enter your password"
                  placeholderTextColor="#98A2B3"
                  returnKeyType="go"
                  secureTextEntry={!showPassword}
                  style={styles.input}
                  value={confirmPassword}
                />
              </View>
            )}

            {configurationMessage && (
              <View style={styles.notice}>
                <Ionicons name="information-circle-outline" size={20} color="#855B12" />
                <Text style={styles.noticeText}>{configurationMessage}</Text>
              </View>
            )}

            {formError && <Text accessibilityLiveRegion="polite" style={styles.error}>{formError}</Text>}
            {formMessage && (
              <Text accessibilityLiveRegion="polite" style={styles.success}>{formMessage}</Text>
            )}

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
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitText}>
                  {mode === 'sign-in' ? 'Sign in' : 'Create account'}
                </Text>
              )}
            </Pressable>

            <Text style={styles.securityNote}>Your account is securely managed with Supabase.</Text>
          </View>

          <Text style={styles.footer}>Simple tools for better tenant care.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
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
    backgroundColor: '#208AEF',
    marginBottom: 12,
  },
  brandName: {
    color: '#14243A',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  tagline: {
    color: '#667085',
    fontSize: 14,
    marginTop: 5,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    padding: 24,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9EEF5',
    shadowColor: '#18304D',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: 3,
  },
  title: {
    color: '#14243A',
    fontSize: 25,
    fontWeight: '700',
  },
  subtitle: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 7,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: '#F2F5F9',
    padding: 4,
    borderRadius: 12,
    marginTop: 24,
    marginBottom: 22,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    borderRadius: 9,
  },
  modeButtonSelected: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#14243A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  modeText: {
    color: '#667085',
    fontSize: 14,
    fontWeight: '600',
  },
  modeTextSelected: {
    color: '#14243A',
  },
  field: {
    marginBottom: 16,
  },
  label: {
    color: '#344054',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    color: '#14243A',
    fontSize: 15,
  },
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
  },
  passwordInput: {
    flex: 1,
    minHeight: 48,
    paddingLeft: 14,
    color: '#14243A',
    fontSize: 15,
  },
  visibilityButton: {
    width: 46,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    marginBottom: 14,
    borderRadius: 10,
    backgroundColor: '#FFF8E7',
  },
  noticeText: {
    flex: 1,
    color: '#704B0B',
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  success: {
    color: '#067647',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  submitButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#208AEF',
    marginTop: 3,
  },
  submitButtonPressed: {
    backgroundColor: '#1475D1',
  },
  submitButtonDisabled: {
    opacity: 0.55,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  securityNote: {
    color: '#98A2B3',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 18,
  },
  footer: {
    color: '#98A2B3',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
  },
});
