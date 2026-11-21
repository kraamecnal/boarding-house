import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  DuplicateRoomNameError,
  isOccupied,
  useRooms,
  type Room,
} from '@/contexts/RoomsContext';

const MAX_MONTHLY_RENT = 99_999_999.99;

type Props = {
  room: Room;
  onCancel: () => void;
  onSaved: (room: Room) => void;
};

function formatEditableRate(value: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseRate(value: string): { value: number | null; error: string | null } {
  const normalized = value.trim().replaceAll(',', '');
  if (!normalized) {
    return { value: null, error: 'Enter a monthly rent.' };
  }
  if (
    !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value.trim())
  ) {
    return {
      value: null,
      error: 'Enter a valid rent with at most 2 decimal places.',
    };
  }
  const rate = Number(normalized);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { value: null, error: 'Monthly rent must be greater than zero.' };
  }
  if (rate > MAX_MONTHLY_RENT) {
    return { value: null, error: 'Monthly rent cannot exceed ₱99,999,999.99.' };
  }
  return { value: rate, error: null };
}

export default function RoomEditModal({ room, onCancel, onSaved }: Props) {
  const { updateRoom } = useRooms();
  const initialRate = formatEditableRate(room.monthlyRate);
  const [roomName, setRoomName] = useState(room.roomName);
  const [monthlyRent, setMonthlyRent] = useState(initialRate);
  const [nameError, setNameError] = useState<string | null>(null);
  const [rentError, setRentError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const parsedRate = parseRate(monthlyRent);
  const nameChanged = roomName.trim() !== room.roomName;
  const rentChanged =
    parsedRate.value === null
      ? monthlyRent.trim() !== initialRate
      : parsedRate.value !== room.monthlyRate;
  const hasChanges = nameChanged || rentChanged;

  const close = () => {
    if (!isSaving) onCancel();
  };

  const performSave = async () => {
    if (isSaving || !hasChanges) return;
    const trimmedName = roomName.trim();
    const nextRate = parseRate(monthlyRent);
    setNameError(trimmedName ? null : 'Enter a room name.');
    setRentError(nextRate.error);
    setSaveError(null);
    if (!trimmedName || nextRate.value === null) return;

    setIsSaving(true);
    try {
      const updatedRoom = await updateRoom(room.id, {
        roomName: trimmedName,
        monthlyRate: nextRate.value,
      });
      onSaved(updatedRoom);
    } catch (error: unknown) {
      if (error instanceof DuplicateRoomNameError) {
        setNameError(error.message);
      } else {
        setSaveError(
          error instanceof Error
            ? error.message
            : 'Could not save this room. Please try again.',
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const requestSave = () => {
    const trimmedName = roomName.trim();
    const nextRate = parseRate(monthlyRent);
    setNameError(trimmedName ? null : 'Enter a room name.');
    setRentError(nextRate.error);
    if (!trimmedName || nextRate.value === null) return;

    if (rentChanged && isOccupied(room)) {
      const tenant = room.tenant;
      Alert.alert(
        'Change monthly rent?',
        `This will change the rent for ${tenant.firstName} ${tenant.lastName} starting with the next bill. Existing bills are not affected.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', onPress: () => void performSave() },
        ],
      );
      return;
    }
    void performSave();
  };

  return (
    <Modal animationType="slide" onRequestClose={close} transparent visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close edit room"
          accessibilityRole="button"
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Edit room</Text>
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
            <Text style={styles.label}>Room Name</Text>
            <TextInput
              accessibilityLabel="Room Name"
              autoCapitalize="words"
              editable={!isSaving}
              onChangeText={(value) => {
                setRoomName(value);
                if (nameError) setNameError(null);
                if (saveError) setSaveError(null);
              }}
              placeholder="e.g. Room 3B"
              placeholderTextColor="#94A3B8"
              style={[styles.input, nameError && styles.inputError]}
              value={roomName}
            />
            {nameError && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {nameError}
              </Text>
            )}

            <Text style={styles.label}>Monthly Rent</Text>
            <View style={[styles.amountInput, rentError && styles.inputError]}>
              <Text style={styles.currency}>₱</Text>
              <TextInput
                accessibilityLabel="Monthly Rent"
                editable={!isSaving}
                keyboardType="decimal-pad"
                onChangeText={(value) => {
                  setMonthlyRent(value);
                  if (rentError) setRentError(null);
                  if (saveError) setSaveError(null);
                }}
                placeholder="3,500.00"
                placeholderTextColor="#94A3B8"
                style={styles.amountText}
                value={monthlyRent}
              />
            </View>
            {rentError && (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {rentError}
              </Text>
            )}
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
              onPress={requestSave}
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
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 4 },
  title: { color: '#1E3A8A', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#64748B', fontSize: 13, lineHeight: 18 },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
  },
  form: { gap: 7, paddingTop: 22, paddingBottom: 8 },
  label: { marginTop: 8, color: '#1E293B', fontSize: 14, fontWeight: '700' },
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
  amountInput: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  amountText: { flex: 1, paddingVertical: 11, color: '#1E293B', fontSize: 16 },
  currency: { color: '#64748B', fontSize: 16, fontWeight: '700' },
  inputError: { borderColor: '#B42318' },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 14 },
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
  saveButtonDisabled: { backgroundColor: '#93C5FD' },
  cancelLabel: { color: '#475569', fontSize: 14, fontWeight: '700' },
  saveLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  buttonPressed: { opacity: 0.78 },
});
