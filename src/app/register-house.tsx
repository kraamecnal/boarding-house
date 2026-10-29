import { useRouter } from 'expo-router';
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

const MAX_NAME = 40;
const MAX_ADDRESS = 120;

export default function NewBoardingHouseScreen() {
  const router = useRouter();
  const { addHouse, isNameTaken } = useBoardingHouses();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();

    if (!trimmedName) return Alert.alert('Missing info', 'Please enter a boarding house name.');
    if (!trimmedAddress) return Alert.alert('Missing info', 'Please enter the address.');
    if (isNameTaken(trimmedName)) {
      return Alert.alert('Name already used', `A boarding house named "${trimmedName}" already exists.`);
    }

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await addHouse({ name: trimmedName, address: trimmedAddress });
      router.back();
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : 'Could not register this boarding house.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Boarding House name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. BH5"
          placeholderTextColor="#8A94A6"
          maxLength={MAX_NAME}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Address</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={address}
          onChangeText={setAddress}
          placeholder="Street, barangay, city"
          placeholderTextColor="#8A94A6"
          maxLength={MAX_ADDRESS}
          multiline
          textAlignVertical="top"
        />
        <Text style={styles.counter}>
          {address.length}/{MAX_ADDRESS}
        </Text>

        {submitError && <Text accessibilityLiveRegion="polite" style={styles.error}>{submitError}</Text>}
        <View style={styles.submitWrapper}>
          <AnimatedButton
            disabled={isSubmitting}
            label={isSubmitting ? 'Saving…' : 'Register'}
            onPress={() => void handleSubmit()}
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
    flexGrow: 1,
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
  multiline: {
    minHeight: 80,
  },
  counter: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
  },
  error: {
    marginTop: 10,
    color: '#B42318',
    fontSize: 13,
  },
  submitWrapper: {
    marginTop: 28,
    alignItems: 'center',
  },
});