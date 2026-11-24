import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
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

import { getSupabaseClient } from '@/utils/supabase';

type ProfileDetails = {
  fullName: string | null;
  email: string;
};

type Step = 'edit' | 'verify-new' | 'verify-current' | 'sync';

type Props = {
  ownerId: string;
  currentName: string;
  currentEmail: string;
  storedFullName: string | null;
  onCancel: () => void;
  onSaved: (profile: ProfileDetails) => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 60;

function authErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export default function ProfileEditModal({
  ownerId,
  currentName,
  currentEmail,
  storedFullName,
  onCancel,
  onSaved,
}: Props) {
  const [step, setStep] = useState<Step>('edit');
  const [name, setName] = useState(currentName);
  const [email, setEmail] = useState(currentEmail);
  const [pendingEmail, setPendingEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const actionInFlight = useRef(false);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCurrentEmail = currentEmail.trim().toLowerCase();
  const nameChanged = trimmedName !== currentName.trim();
  const emailChanged = normalizedEmail !== normalizedCurrentEmail;
  const hasChanges = nameChanged || emailChanged;

  const close = () => {
    if (!isSaving && !isResending) onCancel();
  };

  const syncProfile = async (activeEmail: string) => {
    actionInFlight.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      const changes: { full_name?: string; email_address?: string } = {};
      if (nameChanged) changes.full_name = trimmedName;
      if (emailChanged) changes.email_address = activeEmail;

      const { data, error } = await getSupabaseClient()
        .from('owner_profile')
        .update(changes)
        .eq('id', ownerId)
        .select('full_name, email_address')
        .single();
      if (error) throw error;
      if (!data) throw new Error('The profile update returned no row.');

      onSaved({
        fullName: data.full_name ?? null,
        email: data.email_address ?? activeEmail,
      });
    } catch (error: unknown) {
      if (emailChanged) {
        setVerifiedEmail(activeEmail);
        setStep('sync');
      } else {
        setStep('edit');
      }
      setSaveError(
        authErrorMessage(error, 'Could not save the profile. Please try again.'),
      );
    } finally {
      actionInFlight.current = false;
      setIsSaving(false);
    }
  };

  const continueEditing = async () => {
    if (actionInFlight.current || !hasChanges) return;

    setNameError(trimmedName ? null : 'Enter a name.');
    setEmailError(
      EMAIL_PATTERN.test(normalizedEmail) ? null : 'Enter a valid email address.',
    );
    setSaveError(null);
    if (!trimmedName || !EMAIL_PATTERN.test(normalizedEmail)) return;

    if (!emailChanged) {
      await syncProfile(currentEmail);
      return;
    }

    actionInFlight.current = true;
    setIsSaving(true);
    try {
      const { data, error } = await getSupabaseClient().auth.updateUser({
        email: normalizedEmail,
      });
      if (error) throw error;

      const authEmail = data.user?.email?.trim().toLowerCase();
      if (authEmail === normalizedEmail) {
        await syncProfile(normalizedEmail);
        return;
      }

      setPendingEmail(normalizedEmail);
      setOtp('');
      setNotice(`A verification code was sent to ${normalizedEmail}.`);
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
      setStep('verify-new');
    } catch (error: unknown) {
      setSaveError(
        authErrorMessage(
          error,
          'Could not start email verification. Check your connection and try again.',
        ),
      );
      setStep('edit');
    } finally {
      actionInFlight.current = false;
      setIsSaving(false);
    }
  };

  const verifyCode = async () => {
    if (
      actionInFlight.current ||
      !/^\d{6}$/.test(otp) ||
      (step !== 'verify-new' && step !== 'verify-current')
    ) {
      return;
    }

    actionInFlight.current = true;
    setIsSaving(true);
    setSaveError(null);
    setNotice(null);
    const verificationEmail = step === 'verify-new' ? pendingEmail : normalizedCurrentEmail;
    try {
      const { data, error } = await getSupabaseClient().auth.verifyOtp({
        email: verificationEmail,
        token: otp,
        type: 'email_change',
      });
      if (error) throw error;

      const authEmail = data.user?.email?.trim().toLowerCase();
      if (authEmail === normalizedEmail) {
        await syncProfile(normalizedEmail);
        return;
      }

      if (step === 'verify-new') {
        setOtp('');
        setNotice(`The new address is verified. Enter the code sent to ${currentEmail}.`);
        setResendSeconds(RESEND_COOLDOWN_SECONDS);
        setStep('verify-current');
        return;
      }

      throw new Error(
        'Supabase has not completed the email change. Verify both email codes and try again.',
      );
    } catch (error: unknown) {
      setSaveError(
        authErrorMessage(error, 'That code is invalid or expired. Check it or request a new code.'),
      );
    } finally {
      actionInFlight.current = false;
      setIsSaving(false);
    }
  };

  const resendCode = async () => {
    if (actionInFlight.current || resendSeconds > 0 || isResending) return;
    const targetEmail =
      step === 'verify-new'
        ? pendingEmail
        : step === 'verify-current'
          ? normalizedCurrentEmail
          : '';
    if (!targetEmail) return;

    actionInFlight.current = true;
    setIsResending(true);
    setSaveError(null);
    try {
      const { error } = await getSupabaseClient().auth.resend({
        type: 'email_change',
        email: targetEmail,
      });
      if (error) throw error;
      setNotice(`A new verification code was sent to ${targetEmail}.`);
      setResendSeconds(RESEND_COOLDOWN_SECONDS);
    } catch (error: unknown) {
      setSaveError(
        authErrorMessage(
          error,
          'Could not resend the verification code. Please wait a moment and try again.',
        ),
      );
    } finally {
      actionInFlight.current = false;
      setIsResending(false);
    }
  };

  const showVerification = step === 'verify-new' || step === 'verify-current';
  const verificationEmail = step === 'verify-new' ? pendingEmail : currentEmail;
  const primaryDisabled =
    step === 'edit'
      ? !hasChanges || isSaving
      : step === 'sync'
        ? isSaving || !verifiedEmail
        : !/^\d{6}$/.test(otp) || isSaving;

  return (
    <Modal animationType="slide" onRequestClose={close} transparent visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close profile editor"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{showVerification ? 'Verify Email' : 'Edit Profile'}</Text>
            <Pressable
              accessibilityLabel="Cancel profile editing"
              accessibilityRole="button"
              disabled={isSaving || isResending}
              onPress={close}
              style={styles.closeButton}>
              <Ionicons color="#64748B" name="close" size={22} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {step === 'edit' ? (
              <>
                <Text style={styles.label}>Name</Text>
                <TextInput
                  accessibilityLabel="Name"
                  autoCapitalize="words"
                  editable={!isSaving}
                  onChangeText={(value) => {
                    setName(value);
                    if (nameError) setNameError(null);
                    if (saveError) setSaveError(null);
                  }}
                  placeholder="Your name"
                  placeholderTextColor="#94A3B8"
                  style={[styles.input, nameError && styles.inputError]}
                  value={name}
                />
                {nameError && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>
                    {nameError}
                  </Text>
                )}

                <Text style={styles.label}>Email address</Text>
                <TextInput
                  accessibilityLabel="Email address"
                  autoCapitalize="none"
                  autoComplete="email"
                  editable={!isSaving}
                  keyboardType="email-address"
                  onChangeText={(value) => {
                    setEmail(value);
                    if (emailError) setEmailError(null);
                    if (saveError) setSaveError(null);
                  }}
                  placeholder="name@example.com"
                  placeholderTextColor="#94A3B8"
                  style={[styles.input, emailError && styles.inputError]}
                  value={email}
                />
                {emailError && (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>
                    {emailError}
                  </Text>
                )}
              </>
            ) : showVerification ? (
              <>
                <Text style={styles.verificationCopy}>
                  Enter the six-digit code sent to {verificationEmail}.
                </Text>
                <TextInput
                  accessibilityLabel={`Six-digit verification code for ${verificationEmail}`}
                  autoComplete="one-time-code"
                  editable={!isSaving && !isResending}
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={(value) => {
                    setOtp(value.replace(/\D/g, '').slice(0, 6));
                    if (saveError) setSaveError(null);
                  }}
                  placeholder="000000"
                  placeholderTextColor="#94A3B8"
                  selectTextOnFocus
                  style={[styles.input, styles.otpInput]}
                  textContentType="oneTimeCode"
                  value={otp}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={resendSeconds > 0 || isResending || isSaving}
                  onPress={() => void resendCode()}
                  style={styles.resendButton}>
                  <Text
                    style={[
                      styles.resendLabel,
                      (resendSeconds > 0 || isResending || isSaving) &&
                        styles.resendLabelDisabled,
                    ]}>
                    {isResending
                      ? 'Resending…'
                      : resendSeconds > 0
                        ? `Resend code in ${resendSeconds}s`
                        : 'Resend code'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.verificationCopy}>
                The new email address is verified. Retry saving the profile details.
              </Text>
            )}

            {notice && (
              <Text accessibilityLiveRegion="polite" style={styles.notice}>
                {notice}
              </Text>
            )}
            {saveError && (
              <Text accessibilityLiveRegion="assertive" style={styles.error}>
                {saveError}
              </Text>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving || isResending}
              onPress={close}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && !isSaving && !isResending && styles.buttonPressed,
              ]}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={primaryDisabled}
              onPress={() => {
                if (step === 'edit') {
                  void continueEditing();
                } else if (showVerification) {
                  void verifyCode();
                } else if (verifiedEmail) {
                  void syncProfile(verifiedEmail);
                }
              }}
              style={({ pressed }) => [
                styles.saveButton,
                primaryDisabled && styles.saveButtonDisabled,
                pressed && !primaryDisabled && styles.buttonPressed,
              ]}>
              {isSaving && <ActivityIndicator color="#FFFFFF" size="small" />}
              <Text style={styles.saveLabel}>
                {isSaving
                  ? 'Saving…'
                  : step === 'edit'
                    ? emailChanged
                      ? 'Continue'
                      : 'Save Changes'
                    : step === 'sync'
                      ? 'Retry Save'
                      : 'Verify & Save'}
              </Text>
            </Pressable>
          </View>
          {storedFullName === null && step === 'edit' && (
            <Text style={styles.helper}>
              A custom name will replace the email-based display name.
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    maxHeight: '88%',
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#FFFFFF',
  },
  handle: {
    width: 40,
    height: 4,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 14,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    flex: 1,
    color: '#1E3A8A',
    fontSize: 20,
    fontWeight: '700',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
  },
  form: {
    gap: 7,
    paddingTop: 18,
    paddingBottom: 8,
  },
  label: {
    marginTop: 8,
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    color: '#1E293B',
    fontSize: 16,
  },
  inputError: {
    borderColor: '#B42318',
  },
  error: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 18,
  },
  notice: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  verificationCopy: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 21,
  },
  otpInput: {
    marginTop: 8,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 10,
    textAlign: 'center',
  },
  resendButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  resendLabel: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  resendLabelDisabled: {
    color: '#94A3B8',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 14,
  },
  cancelButton: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
  },
  saveButton: {
    minHeight: 48,
    flex: 1.45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 11,
    backgroundColor: '#2563EB',
  },
  saveButtonDisabled: {
    backgroundColor: '#93C5FD',
  },
  cancelLabel: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  saveLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  helper: {
    marginTop: 10,
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.78,
  },
});
