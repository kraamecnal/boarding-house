import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  TENANT_DOCUMENT_MAX_BYTES,
  TENANT_DOCUMENT_MIME_TYPES,
  type TenantDocumentImage,
} from '@/data/tenantDocuments';

export type { TenantDocumentImage } from '@/data/tenantDocuments';

type Props = {
  label: string;
  image: TenantDocumentImage | null;
  onChange: (image: TenantDocumentImage | null) => void;
  placeholder: string;
  isUploading?: boolean;
  disabled?: boolean;
};

function mimeTypeFor(asset: ImagePicker.ImagePickerAsset) {
  const fileName = asset.fileName ?? asset.uri.split('?')[0];
  const extension = fileName.split('.').pop()?.toLowerCase();
  const fallbackType =
    extension === 'jpg' || extension === 'jpeg'
      ? 'image/jpeg'
      : extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : undefined;
  const mimeType = asset.mimeType || asset.file?.type || fallbackType;
  return TENANT_DOCUMENT_MIME_TYPES.find((type) => type === mimeType);
}

export default function ImageField({
  label,
  image,
  onChange,
  placeholder,
  isUploading = false,
  disabled = false,
}: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectImage = async (source: 'camera' | 'library') => {
    setShowPicker(false);
    setError(null);
    setIsPicking(true);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('Allow camera access to take a document photo.');
          return;
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setError('Allow photo library access to attach a document photo.');
          return;
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.8,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const mimeType = mimeTypeFor(asset);
      if (!mimeType) {
        setError('Choose a JPEG, PNG, or WebP image.');
        return;
      }

      const fileSize = asset.fileSize ?? asset.file?.size;
      if (fileSize !== undefined && fileSize > TENANT_DOCUMENT_MAX_BYTES) {
        setError('Choose an image smaller than 5 MB.');
        return;
      }

      onChange({
        uri: asset.uri,
        mimeType,
        fileSize,
        file: asset.file,
      });
    } catch (selectionError: unknown) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : 'Could not select this image. Please try again.',
      );
    } finally {
      setIsPicking(false);
    }
  };

  const locked = disabled || isUploading || isPicking;

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.previewFrame}>
        {image ? (
          <Image source={{ uri: image.uri }} style={styles.preview} />
        ) : (
          <Text style={styles.placeholder}>{placeholder}</Text>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => setShowPicker(true)}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed, locked && styles.disabled]}>
          <Text style={styles.actionLabel}>{image ? 'Replace photo' : 'Choose or take photo'}</Text>
        </Pressable>
        {image && (
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() => {
              setError(null);
              onChange(null);
            }}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed, locked && styles.disabled]}>
            <Text style={styles.removeLabel}>Remove</Text>
          </Pressable>
        )}
        {(isUploading || isPicking) && (
          <View style={styles.uploading}>
            <ActivityIndicator color="#2563EB" size="small" />
            <Text style={styles.uploadingLabel}>
              {isUploading ? 'Uploading' : 'Opening picker'}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.hint}>JPEG, PNG, or WebP · up to 5 MB</Text>
      {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}

      <Modal
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
        transparent
        visible={showPicker}>
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel="Close image source options"
            onPress={() => setShowPicker(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <Text style={styles.modalDescription}>
              Select a JPEG, PNG, or WebP image under 5 MB.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void selectImage('camera')}
              style={styles.modalAction}>
              <Text style={styles.modalActionLabel}>Take a photo</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void selectImage('library')}
              style={styles.modalAction}>
              <Text style={styles.modalActionLabel}>Choose from photo library</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowPicker(false)}
              style={styles.cancelAction}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: '#1E3A8A',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 8,
  },
  previewFrame: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#F8FAFC',
  },
  placeholder: {
    color: '#64748B',
    fontSize: 14,
    paddingHorizontal: 20,
    textAlign: 'center',
  },
  preview: {
    width: '100%',
    height: 180,
    resizeMode: 'cover',
  },
  actions: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionButton: {
    minHeight: 38,
    justifyContent: 'center',
  },
  actionLabel: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  removeLabel: {
    color: '#B42318',
    fontSize: 13,
    fontWeight: '600',
  },
  uploading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  uploadingLabel: {
    color: '#64748B',
    fontSize: 12,
  },
  hint: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  error: {
    color: '#B42318',
    fontSize: 13,
    marginTop: 6,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.7,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  modalCard: {
    gap: 12,
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  modalTitle: {
    color: '#1E3A8A',
    fontSize: 18,
    fontWeight: '700',
  },
  modalDescription: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
  },
  modalAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
  },
  modalActionLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelAction: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
});
