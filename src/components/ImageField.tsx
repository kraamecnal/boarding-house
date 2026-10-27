import * as ImagePicker from 'expo-image-picker';
import { Alert, Image, Pressable, StyleSheet, Text } from 'react-native';

type Props = {
  label: string;
  uri: string | null;
  onChange: (uri: string) => void;
  placeholder: string;
  permissionMessage?: string;
};

export default function ImageField({
  label,
  uri,
  onChange,
  placeholder,
  permissionMessage = 'Please allow photo library access so you can attach a photo.',
}: Props) {
  const pick = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', permissionMessage);
      return;
    }
    // allowsEditing stays off: we want the full, uncropped photo.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.length) {
      onChange(result.assets[0].uri);
    }
  };

  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={styles.picker}
        onPress={pick}
        accessibilityRole="button"
        accessibilityLabel={uri ? `Replace ${label} photo` : `Attach ${label} photo`}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.preview} />
        ) : (
          <Text style={styles.placeholder}>{placeholder}</Text>
        )}
      </Pressable>
      {uri && (
        <Pressable onPress={pick}>
          <Text style={styles.replace}>Replace photo</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    color: '#1A2B3C',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 14,
  },
  picker: {
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 8,
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#F7F8FA',
  },
  placeholder: {
    color: '#6B7280',
    fontSize: 14,
    paddingHorizontal: 20,
    textAlign: 'center',
  },
  preview: {
    width: '100%',
    height: 180,
    resizeMode: 'cover',
  },
  replace: {
    color: '#007AFF',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'right',
  },
});