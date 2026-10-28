import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { useAuth } from '@/contexts/AuthContext';

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 30;
const MIN_PASSWORD_LENGTH = 8;

type Props = {
  visible: boolean;
  onCancel: () => void;
  onVerified: () => void;
};

export default function PasswordPromptModal({ visible, onCancel, onVerified }: Props) {
  const { hasPaymentPassword, setPaymentPassword, verifyPassword } = useAuth();
  const isCreating = !hasPaymentPassword;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const secondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const isLocked = secondsLeft > 0;

  // Never keep passwords around after the prompt closes.
  useEffect(() => {
    if (!visible) {
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setError(null);
    }
  }, [visible]);

  // Counts down the lock, then lets the person try again.
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= lockedUntil) {
        setLockedUntil(null);
        setFailedAttempts(0);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  const canSubmit = isCreating ? !!password && !!confirmPassword : !!password;

  const handleCreate = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    await setPaymentPassword(password);
    setPassword('');
    setConfirmPassword('');
    onVerified();
  };

  const handleVerify = async () => {
    const isCorrect = await verifyPassword(password);
    if (isCorrect) {
      setFailedAttempts(0);
      setPassword('');
      onVerified();
      return;
    }

    const attempts = failedAttempts + 1;
    setFailedAttempts(attempts);
    setPassword('');
    if (attempts >= MAX_ATTEMPTS) {
      const current = Date.now();
      setNow(current);
      setLockedUntil(current + LOCK_SECONDS * 1000);
    } else {
      setError('Incorrect password. Try again.');
    }
  };

  const handleConfirm = async () => {
    if (!canSubmit || isBusy || (!isCreating && isLocked)) return;
    setError(null);
    setIsBusy(true);
    try {
      if (isCreating) {
        await handleCreate();
      } else {
        await handleVerify();
      }
    } catch (caught: unknown) {
      const isConnectionProblem =
        caught instanceof Error && caught.name === 'AuthRetryableFetchError';
      setError(
        isConnectionProblem
          ? "Couldn't reach the server. Check your connection and try again."
          : caught instanceof Error
            ? caught.message
            : 'Something went wrong. Try again.',
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleCancel = () => {
    if (!isBusy) onCancel();
  };

  const editable = !isBusy && (isCreating || !isLocked);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {isCreating ? 'Create a payment password' : 'Confirm payment'}
          </Text>
          <Text style={styles.subtitle}>
            {isCreating
              ? "Marking a bill as paid needs a password. Create one now, and you'll enter it each time."
              : 'Enter your payment password to mark this bill as paid.'}
          </Text>

          <View style={styles.inputWrap}>
            <TextInput
              accessibilityLabel={isCreating ? 'New password' : 'Password'}
              autoCapitalize="none"
              autoComplete={isCreating ? 'new-password' : 'current-password'}
              autoCorrect={false}
              editable={editable}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError(null);
              }}
              onSubmitEditing={isCreating ? undefined : handleConfirm}
              placeholder={isCreating ? 'New password' : 'Password'}
              placeholderTextColor="#98A2B3"
              returnKeyType={isCreating ? 'next' : 'go'}
              secureTextEntry={!showPassword}
              style={styles.input}
              value={password}
            />
            <Pressable
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setShowPassword((shown) => !shown)}
              style={styles.eyeButton}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color="#667085"
              />
            </Pressable>
          </View>

          {isCreating && (
            <View style={[styles.inputWrap, styles.secondInput]}>
              <TextInput
                accessibilityLabel="Confirm new password"
                autoCapitalize="none"
                autoComplete="new-password"
                autoCorrect={false}
                editable={editable}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  if (error) setError(null);
                }}
                onSubmitEditing={handleConfirm}
                placeholder="Confirm password"
                placeholderTextColor="#98A2B3"
                returnKeyType="go"
                secureTextEntry={!showPassword}
                style={styles.input}
                value={confirmPassword}
              />
            </View>
          )}

          {!isCreating && isLocked ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              Too many wrong attempts. Try again in {secondsLeft}s.
            </Text>
          ) : (
            error && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {error}
              </Text>
            )
          )}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={isBusy}
              onPress={handleCancel}
              style={[styles.button, styles.cancelButton]}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit || isBusy || (!isCreating && isLocked)}
              onPress={handleConfirm}
              style={[
                styles.button,
                styles.confirmButton,
                (!canSubmit || isBusy || (!isCreating && isLocked)) && styles.confirmDisabled,
              ]}>
              {isBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmText}>{isCreating ? 'Save password' : 'Confirm'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(20,36,58,0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    padding: 22,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  title: {
    color: '#14243A',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
    marginBottom: 18,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
  },
  secondInput: {
    marginTop: 10,
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    color: '#14243A',
    fontSize: 15,
  },
  eyeButton: {
    width: 46,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  button: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  cancelButton: {
    backgroundColor: '#F2F5F9',
  },
  cancelText: {
    color: '#344054',
    fontSize: 15,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#208AEF',
  },
  confirmDisabled: {
    opacity: 0.5,
  },
  confirmText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});