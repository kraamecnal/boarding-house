import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
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

import {
  DuplicateBoardingHouseNameError,
  useBoardingHouses,
  type BoardingHouse,
} from '@/contexts/BoardingHousesContext';

type Props = {
  house: BoardingHouse;
  onCancel: () => void;
  onSaved: (house: BoardingHouse) => void;
};

export default function BoardingHouseEditModal({ house, onCancel, onSaved }: Props) {
  const { updateHouse } = useBoardingHouses();
  const [name, setName] = useState(house.name);
  const [address, setAddress] = useState(house.address);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const hasChanges =
    name.trim() !== house.name.trim() || address.trim() !== house.address.trim();

  const close = () => {
    if (!isSaving) onCancel();
  };

  const save = async () => {
    if (!hasChanges || isSaving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Enter a boarding house name.');
      return;
    }

    setNameError(null);
    setSaveError(null);
    setIsSaving(true);
    try {
      const updatedHouse = await updateHouse(house.id, { name, address });
      onSaved(updatedHouse);
    } catch (error: unknown) {
      if (error instanceof DuplicateBoardingHouseNameError) {
        setNameError(error.message);
      } else {
        setSaveError(
          error instanceof Error
            ? error.message
            : 'Could not save the boarding house. Please try again.',
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      transparent
      visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close edit boarding house"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Edit boarding house</Text>
              <Text style={styles.subtitle}>Update the details shown across InKeeper.</Text>
            </View>
            <Pressable
              accessibilityLabel="Cancel editing"
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
            <Text style={styles.label}>Boarding House Name</Text>
            <TextInput
              accessibilityLabel="Boarding House Name"
              autoCapitalize="words"
              editable={!isSaving}
              onChangeText={(value) => {
                setName(value);
                if (nameError) setNameError(null);
                if (saveError) setSaveError(null);
              }}
              placeholder="e.g. BH5"
              placeholderTextColor="#94A3B8"
              style={[styles.input, nameError && styles.inputError]}
              value={name}
            />
            {nameError && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {nameError}
              </Text>
            )}

            <Text style={styles.label}>Address</Text>
            <TextInput
              accessibilityLabel="Address"
              editable={!isSaving}
              multiline
              onChangeText={(value) => {
                setAddress(value);
                if (saveError) setSaveError(null);
              }}
              placeholder="Street, barangay, city (optional)"
              placeholderTextColor="#94A3B8"
              style={[styles.input, styles.addressInput]}
              textAlignVertical="top"
              value={address}
            />
            {saveError && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
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
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: '#1E3A8A',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
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
    paddingTop: 22,
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
  addressInput: {
    minHeight: 88,
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
