import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useRooms } from '@/contexts/RoomsContext';
import { sanitizeAmountInput } from '@/utils/billing';

const MAX_ROOM_NAME = 30;

export default function NewRoomScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const boardingHouseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { getHouseById } = useBoardingHouses();
  const { addRoom, isRoomNameTaken } = useRooms();
  const house = boardingHouseId ? getHouseById(boardingHouseId) : undefined;

  const [roomName, setRoomName] = useState('');
  const [monthlyRate, setMonthlyRate] = useState('');

  const handleSubmit = () => {
    if (!boardingHouseId) return;
    const trimmedName = roomName.trim();
    const rate = Number(monthlyRate);

    if (!trimmedName) return Alert.alert('Missing info', 'Please enter a room name.');
    if (isRoomNameTaken(boardingHouseId, trimmedName)) {
      return Alert.alert(
        'Name already used',
        `${house?.name ?? 'This boarding house'} already has a room named "${trimmedName}".`
      );
    }
    if (!monthlyRate.trim() || Number.isNaN(rate) || rate <= 0) {
      return Alert.alert('Missing info', 'Please enter a monthly rate greater than 0.');
    }

    addRoom({ boardingHouseId, roomName: trimmedName, monthlyRate: rate });
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {house && <Text style={styles.houseHint}>Adding a room to {house.name}</Text>}

        <Text style={styles.label}>Room name</Text>
        <TextInput
          style={styles.input}
          value={roomName}
          onChangeText={setRoomName}
          placeholder="e.g. Room 3B"
          placeholderTextColor="#8A94A6"
          maxLength={MAX_ROOM_NAME}
        />

        <Text style={styles.label}>Monthly rate</Text>
        <TextInput
          style={styles.input}
          value={monthlyRate}
          onChangeText={(text) => setMonthlyRate(sanitizeAmountInput(text))}
          keyboardType="decimal-pad"
          placeholder="e.g. 3500"
          placeholderTextColor="#8A94A6"
          maxLength={10}
        />

        <Text style={styles.note}>The room starts as Vacant. Tap it later to register a tenant.</Text>

        <View style={styles.submitWrapper}>
          <AnimatedButton label="Register Room" onPress={handleSubmit} />
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
    flexGrow: 1,
  },
  houseHint: {
    color: '#6B7280',
    fontSize: 13,
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
  note: {
    marginTop: 8,
    color: '#6B7280',
    fontSize: 12,
  },
  submitWrapper: {
    marginTop: 28,
    alignItems: 'center',
  },
});