import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import AnimatedButton from '@/components/AnimatedButton';
import { useRooms } from '@/contexts/RoomsContext';
import { boardingHouses } from '@/data/boardingHouses';

export default function NewRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { addRoom } = useRooms();
  const house = boardingHouses[id as string];

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Missing info', "Please enter the tenant's first and last name.");
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Missing info', 'Please enter a valid email address.');
      return;
    }
    if (!contactNumber.trim()) {
      Alert.alert('Missing info', 'Please enter a contact number.');
      return;
    }
    if (!startDate.trim() || !dueDate.trim()) {
      Alert.alert('Missing info', 'Please enter both the start date and due date (YYYY-MM-DD).');
      return;
    }
    const rentValue = Number(monthlyRent);
    if (!monthlyRent.trim() || Number.isNaN(rentValue) || rentValue <= 0) {
      Alert.alert('Missing info', 'Please enter a valid monthly rent amount.');
      return;
    }

    setSubmitting(true);
    addRoom({
      boardingHouseId: id as string,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      contactNumber: contactNumber.trim(),
      startDate: startDate.trim(),
      dueDate: dueDate.trim(),
      monthlyRent: rentValue,
    });
    setSubmitting(false);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{ title: house ? `Register Tenant — ${house.name}` : 'Register Tenant' }}
      />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>Tenant name</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="First name"
            value={firstName}
            onChangeText={setFirstName}
          />
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="Last name"
            value={lastName}
            onChangeText={setLastName}
          />
        </View>

        <Text style={styles.sectionLabel}>Contact</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Contact number"
          value={contactNumber}
          onChangeText={setContactNumber}
          keyboardType="phone-pad"
        />

        <Text style={styles.sectionLabel}>Rent period</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="Start date (YYYY-MM-DD)"
            value={startDate}
            onChangeText={setStartDate}
          />
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="Due date (YYYY-MM-DD)"
            value={dueDate}
            onChangeText={setDueDate}
          />
        </View>

        <Text style={styles.sectionLabel}>Monthly rent</Text>
        <TextInput
          style={styles.input}
          placeholder="Amount (e.g. 3500)"
          value={monthlyRent}
          onChangeText={setMonthlyRent}
          keyboardType="numeric"
        />

        <View style={styles.submitWrap}>
          <AnimatedButton
            label={submitting ? 'Saving…' : 'Register Room'}
            onPress={handleSubmit}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: 'white' },
  container: {
    padding: 20,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A94A6',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  rowInput: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D8DCE3',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1A2B3C',
    backgroundColor: '#FAFBFC',
  },
  submitWrap: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 40,
  },
});