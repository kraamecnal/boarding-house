import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
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

import { useRooms, type Tenant } from '@/contexts/RoomsContext';

type Props = {
  roomId: string;
  tenant: Tenant;
  onCancel: () => void;
  onSaved: (tenant: Tenant) => void;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_PATTERN = /^\+?[\d\s().-]+$/;

function getContactError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digitCount = trimmed.replace(/\D/g, '').length;
  if (!CONTACT_PATTERN.test(trimmed) || digitCount < 7 || digitCount > 15) {
    return 'Enter a valid contact number or leave it blank.';
  }
  return null;
}

export default function TenantEditModal({ roomId, tenant, onCancel, onSaved }: Props) {
  const { updateTenant } = useRooms();
  const initialName = `${tenant.firstName} ${tenant.lastName}`.trim();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(tenant.email);
  const [contactNumber, setContactNumber] = useState(tenant.contactNumber);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlight = useRef(false);

  const hasChanges =
    name.trim() !== initialName ||
    email.trim() !== tenant.email.trim() ||
    contactNumber.trim() !== tenant.contactNumber.trim();

  const close = () => {
    if (!isSaving) onCancel();
  };

  const save = async () => {
    if (saveInFlight.current || isSaving || !hasChanges) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const nextContactError = getContactError(contactNumber);
    setNameError(trimmedName ? null : 'Enter a tenant name.');
    setEmailError(
      trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)
        ? 'Enter a valid email address or leave it blank.'
        : null,
    );
    setContactError(nextContactError);
    setSaveError(null);

    if (!trimmedName || (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) || nextContactError) {
      return;
    }

    saveInFlight.current = true;
    setIsSaving(true);
    try {
      const updatedTenant = await updateTenant(roomId, {
        name: trimmedName,
        email: trimmedEmail,
        contactNumber: contactNumber.trim(),
      });
      onSaved(updatedTenant);
    } catch (error: unknown) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Could not update the tenant information. Please try again.',
      );
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={close} transparent visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close edit tenant information"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Edit Tenant Information</Text>
            <Pressable
              accessibilityLabel="Cancel editing tenant information"
              accessibilityRole="button"
              disabled={isSaving}
              onPress={close}
              style={styles.closeButton}>
              <Ionicons color="#64748B" name="close" size={22} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>Tenant name</Text>
            <TextInput
              accessibilityLabel="Tenant name"
              autoCapitalize="words"
              editable={!isSaving}
              onChangeText={(value) => {
                setName(value);
                if (nameError) setNameError(null);
                if (saveError) setSaveError(null);
              }}
              placeholder="Tenant name"
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
              placeholder="name@example.com (optional)"
              placeholderTextColor="#94A3B8"
              style={[styles.input, emailError && styles.inputError]}
              value={email}
            />
            {emailError && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {emailError}
              </Text>
            )}

            <Text style={styles.label}>Contact number</Text>
            <TextInput
              accessibilityLabel="Contact number"
              autoComplete="tel"
              editable={!isSaving}
              keyboardType="phone-pad"
              onChangeText={(value) => {
                setContactNumber(value);
                if (contactError) setContactError(null);
                if (saveError) setSaveError(null);
              }}
              placeholder="Contact number (optional)"
              placeholderTextColor="#94A3B8"
              style={[styles.input, contactError && styles.inputError]}
              value={contactNumber}
            />
            {contactError && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {contactError}
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
              disabled={isSaving}
              onPress={close}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && !isSaving && styles.buttonPressed,
              ]}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!hasChanges || isSaving}
              onPress={() => void save()}
              style={({ pressed }) => [
                styles.saveButton,
                (!hasChanges || isSaving) && styles.saveButtonDisabled,
                pressed && hasChanges && !isSaving && styles.buttonPressed,
              ]}>
              {isSaving && <ActivityIndicator color="#FFFFFF" size="small" />}
              <Text style={styles.saveLabel}>
                {isSaving ? 'Saving…' : 'Save Changes'}
              </Text>
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
  buttonPressed: {
    opacity: 0.78,
  },
});
