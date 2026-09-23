import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Image,
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
import { addOneMonth, useRooms } from '@/contexts/RoomsContext';
 
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
 
export default function NewRoomScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const boardingHouseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { addRoom } = useRooms();
 
  const [roomName, setRoomName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [idImageUri, setIdImageUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
 
  const dueDatePreview = useMemo(() => {
    if (!startDate) return null;
    return addOneMonth(toIsoDate(startDate));
  }, [startDate]);
 
  // `onChange` is deprecated on newer datetimepicker versions in favor of
  // separate onValueChange (a date was picked) and onDismiss (cancelled)
  // callbacks.
  const handleDateSelected = (_event: unknown, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selected) setStartDate(selected);
  };
 
  const handleDatePickerDismiss = () => {
    setShowDatePicker(false);
  };
 
  const pickIdImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        'Please allow photo library access so you can attach a valid ID.'
      );
      return;
    }
    // allowsEditing is left off on purpose: it hands off to the phone's
    // native crop screen (whose button labels — "Crop", "Save", "Done" —
    // are controlled by the OS, not by us) and a full, uncropped photo of
    // the ID is what we actually want anyway.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.length) {
      setIdImageUri(result.assets[0].uri);
    }
  };
 
  const handleSubmit = () => {
    if (!boardingHouseId) return;
    if (!roomName.trim()) return Alert.alert('Missing info', 'Please enter a room name.');
    if (!firstName.trim() || !lastName.trim())
      return Alert.alert('Missing info', "Please enter the tenant's full name.");
    if (!email.trim()) return Alert.alert('Missing info', 'Please enter an email address.');
    if (!contactNumber.trim())
      return Alert.alert('Missing info', 'Please enter a contact number.');
    if (!startDate) return Alert.alert('Missing info', 'Please pick a start date.');
    const rent = Number(monthlyRent);
    if (!monthlyRent.trim() || Number.isNaN(rent) || rent <= 0) {
      return Alert.alert('Missing info', 'Please enter a valid monthly rent amount.');
    }
    if (!idImageUri) {
      return Alert.alert('Missing info', "Please attach a photo of the tenant's valid ID.");
    }
 
    setSubmitting(true);
    addRoom({
      boardingHouseId,
      roomName: roomName.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      contactNumber: contactNumber.trim(),
      startDate: toIsoDate(startDate),
      monthlyRent: rent,
      idImageUri,
    });
    setSubmitting(false);
    router.back();
  };
 
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Room name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Room 3B"
          placeholderTextColor="#8A94A6"
          value={roomName}
          onChangeText={setRoomName}
        />
 
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
 
        <Text style={styles.label}>Monthly rent</Text>
        <TextInput
          style={styles.input}
          value={monthlyRent}
          onChangeText={setMonthlyRent}
          keyboardType="numeric"
          placeholder="e.g. 3500"
          placeholderTextColor="#8A94A6"
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
 
        <Text style={styles.label}>Valid ID</Text>
        <Pressable style={styles.idPicker} onPress={pickIdImage}>
          {idImageUri ? (
            <Image source={{ uri: idImageUri }} style={styles.idPreview} />
          ) : (
            <Text style={styles.idPickerText}>Tap to attach a photo of a valid ID</Text>
          )}
        </Pressable>
        {idImageUri && (
          <Pressable onPress={pickIdImage}>
            <Text style={styles.idReplaceText}>Replace photo</Text>
          </Pressable>
        )}
 
        <View style={styles.submitWrapper}>
          <AnimatedButton
            label={submitting ? 'Registering…' : 'Register Tenant'}
            onPress={handleSubmit}
          />
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
  idPicker: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#F7F8FA',
  },
  idPickerText: {
    color: '#6B7280',
    fontSize: 14,
    paddingHorizontal: 20,
    textAlign: 'center',
  },
  idPreview: {
    width: '100%',
    height: 180,
    resizeMode: 'cover',
  },
  idReplaceText: {
    color: '#007AFF',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'right',
  },
  submitWrapper: {
    marginTop: 28,
    alignItems: 'center',
  },
});