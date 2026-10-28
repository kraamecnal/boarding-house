import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
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

import AnimatedButton from '@/components/AnimatedButton';
import ImageField from '@/components/ImageField';
import { addOneMonth, useRooms } from '@/contexts/RoomsContext';
import { formatPeso } from '@/utils/billing';

function toIsoDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toDisplayDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function RegisterTenantScreen() {
  const params = useLocalSearchParams<{ id: string; roomId: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const router = useRouter();
  const { getRoomById, assignTenant } = useRooms();
  const room = roomId ? getRoomById(roomId) : undefined;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [idImageUri, setIdImageUri] = useState<string | null>(null);
  const [contractImageUri, setContractImageUri] = useState<string | null>(null);

  const dueDatePreview = useMemo(() => {
    if (!startDate) return null;
    return addOneMonth(toIsoDate(startDate));
  }, [startDate]);

  const handleDateSelected = (_event: unknown, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selected) setStartDate(selected);
  };

  const handleDatePickerDismiss = () => {
    setShowDatePicker(false);
  };

  if (!room) {
    return (
      <View style={styles.centered}>
        <Text style={styles.centeredText}>Room not found.</Text>
      </View>
    );
  }

  if (room.status === 'occupied') {
    return (
      <View style={styles.centered}>
        <Text style={styles.centeredText}>{room.roomName} already has a tenant.</Text>
      </View>
    );
  }

  const handleSubmit = () => {
    if (!firstName.trim() || !lastName.trim())
      return Alert.alert('Missing info', "Please enter the tenant's full name.");
    if (!email.trim()) return Alert.alert('Missing info', 'Please enter an email address.');
    if (!contactNumber.trim())
      return Alert.alert('Missing info', 'Please enter a contact number.');
    if (!startDate) return Alert.alert('Missing info', 'Please pick a start date.');
    if (!idImageUri) {
      return Alert.alert('Missing info', "Please attach a photo of the tenant's valid ID.");
    }
    if (!contractImageUri) {
      return Alert.alert('Missing info', 'Please attach a photo of the signed contract.');
    }

    assignTenant(room.id, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      contactNumber: contactNumber.trim(),
      startDate: toIsoDate(startDate),
      idImageUri,
      contractImageUri,
    });
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.roomBanner}>
          <Text style={styles.roomBannerName}>{room.roomName}</Text>
          <Text style={styles.roomBannerRate}>{formatPeso(room.monthlyRate)} / month</Text>
        </View>

        <Text style={styles.label}>First name</Text>
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />

        <Text style={styles.label}>Last name</Text>
        <TextInput style={styles.input} value={lastName} onChangeText={setLastName} />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Contact number</Text>
        <TextInput
          style={styles.input}
          value={contactNumber}
          onChangeText={setContactNumber}
          keyboardType="phone-pad"
        />

        <Text style={styles.label}>Start date</Text>
        <Pressable style={styles.dateField} onPress={() => setShowDatePicker(true)}>
          <Text style={startDate ? styles.dateText : styles.datePlaceholder}>
            {startDate ? toDisplayDate(startDate) : 'Select start date'}
          </Text>
          <Ionicons name="calendar-outline" size={20} color="#1A2B3C" />
        </Pressable>

        {dueDatePreview && (
          <Text style={styles.dueDateHint}>Due date will be set to {dueDatePreview}</Text>
        )}

        {Platform.OS === 'android' && showDatePicker && (
          <DateTimePicker
            value={startDate ?? new Date()}
            mode="date"
            display="default"
            onValueChange={handleDateSelected}
            onDismiss={handleDatePickerDismiss}
          />
        )}

        {Platform.OS === 'ios' && (
          <Modal visible={showDatePicker} transparent animationType="slide">
            <View style={styles.modalOverlay}>
              <View style={styles.modalSheet}>
                <DateTimePicker
                  value={startDate ?? new Date()}
                  mode="date"
                  display="inline"
                  onValueChange={handleDateSelected}
                />
                <AnimatedButton label="Done" onPress={() => setShowDatePicker(false)} />
              </View>
            </View>
          </Modal>
        )}

        <ImageField
          label="Valid ID"
          uri={idImageUri}
          onChange={setIdImageUri}
          placeholder="Tap to attach a photo of a valid ID"
          permissionMessage="Please allow photo library access so you can attach a valid ID."
        />

        <ImageField
          label="Contract"
          uri={contractImageUri}
          onChange={setContractImageUri}
          placeholder="Tap to attach a photo of the signed contract"
          permissionMessage="Please allow photo library access so you can attach the contract."
        />

        <View style={styles.submitWrapper}>
          <AnimatedButton label="Register Tenant" onPress={handleSubmit} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 48,
    backgroundColor: 'white',
    gap: 6,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    backgroundColor: 'white',
  },
  centeredText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
  },
  roomBanner: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    gap: 2,
  },
  roomBannerName: {
    color: '#1E3A8A',
    fontSize: 18,
    fontWeight: '700',
  },
  roomBannerRate: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  label: {
    color: '#1A2B3C',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1A2B3C',
  },
  dateField: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: {
    fontSize: 16,
    color: '#1A2B3C',
  },
  datePlaceholder: {
    fontSize: 16,
    color: '#8A94A6',
  },
  dueDateHint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  modalSheet: {
    backgroundColor: 'white',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 12,
    alignItems: 'center',
  },
  submitWrapper: {
    marginTop: 28,
    alignItems: 'center',
  },
});