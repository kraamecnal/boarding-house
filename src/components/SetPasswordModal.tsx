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

const MIN_PASSWORD_LENGTH = 8;

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Creates or changes the payment password. This password is only used to
 * confirm the PAID button on a bill; it is not a sign-in password.
 */
export default function SetPasswordModal({ visible, onClose, onSaved }: Props) {
  const { hasPaymentPassword, setPaymentPassword, verifyPassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setShowPassword(false);
      setError(null);
    }
  }, [visible]);

  const handleSave = async () => {
    if (isSaving) return;
    if (hasPaymentPassword && !current) {
      setError('Enter your current payment password.');
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    if (hasPaymentPassword && next === current) {
      setError('Choose a different password than your current one.');
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      if (hasPaymentPassword) {
        const isCorrect = await verifyPassword(current);
        if (!isCorrect) {
          setError('Current password is incorrect.');
          return;
        }
      }
      await setPaymentPassword(next);
      onSaved();
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
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (!isSaving) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {hasPaymentPassword ? 'Change payment password' : 'Set payment password'}
          </Text>
          <Text style={styles.subtitle}>
            This password is only used to confirm the PAID button on a bill. It is not used to sign
            in.
          </Text>

          {hasPaymentPassword && (
            <PasswordField
              label="Current password"
              value={current}
              onChangeText={(text) => {
                setCurrent(text);
                setError(null);
              }}
              showPassword={showPassword}
              onToggleShow={() => setShowPassword((shown) => !shown)}
              editable={!isSaving}
              autoComplete="current-password"
            />
          )}
          <PasswordField
            label="New password"
            value={next}
            onChangeText={(text) => {
              setNext(text);
              setError(null);
            }}
            showPassword={showPassword}
            onToggleShow={() => setShowPassword((shown) => !shown)}
            editable={!isSaving}
            autoComplete="new-password"
            showToggle={!hasPaymentPassword}
          />
          <PasswordField
            label="Confirm new password"
            value={confirm}
            onChangeText={(text) => {
              setConfirm(text);
              setError(null);
            }}
            showPassword={showPassword}
            onToggleShow={() => setShowPassword((shown) => !shown)}
            editable={!isSaving}
            autoComplete="new-password"
            showToggle={false}
            onSubmitEditing={handleSave}
          />

          {error && (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {error}
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={handleClose}
              style={[styles.button, styles.cancelButton]}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={handleSave}
              style={[styles.button, styles.saveButton, isSaving && styles.disabled]}>
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PasswordField({
  label,
  value,
  onChangeText,
  showPassword,
  onToggleShow,
  editable,
  autoComplete,
  showToggle = true,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  showPassword: boolean;
  onToggleShow: () => void;
  editable: boolean;
  autoComplete: 'current-password' | 'new-password';
  showToggle?: boolean;
  onSubmitEditing?: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoComplete={autoComplete}
          autoCorrect={false}
          editable={editable}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={onSubmitEditing ? 'go' : 'next'}
          secureTextEntry={!showPassword}
          style={styles.input}
          value={value}
        />
        {showToggle && (
          <Pressable
            accessibilityLabel={showPassword ? 'Hide passwords' : 'Show passwords'}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onToggleShow}
            style={styles.eyeButton}>
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color="#667085"
            />
          </Pressable>
        )}
      </View>
    </View>
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
  title: { color: '#14243A', fontSize: 20, fontWeight: '700' },
  subtitle: {
    color: '#667085',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
    marginBottom: 14,
  },
  field: { marginTop: 10 },
  label: { color: '#344054', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    color: '#14243A',
    fontSize: 15,
  },
  eyeButton: { width: 46, height: 48, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#B42318', fontSize: 13, lineHeight: 19, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  button: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  cancelButton: { backgroundColor: '#F2F5F9' },
  cancelText: { color: '#344054', fontSize: 15, fontWeight: '600' },
  saveButton: { backgroundColor: '#208AEF' },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});