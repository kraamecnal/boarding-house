import { File as ExpoFile } from 'expo-file-system';
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
  type TenantDocumentProgressState,
} from '@/data/tenantDocuments';

export type { TenantDocumentImage } from '@/data/tenantDocuments';

type Props = {
  label: string;
  image: TenantDocumentImage | null;
  onChange: (image: TenantDocumentImage | null) => void;
  placeholder: string;
  isUploading?: boolean;
  progressState?: TenantDocumentProgressState;
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
  progressState = 'idle',
  disabled = false,
}: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectImage = async (source: 'camera' | 'library') => {
    const startedAt = Date.now();
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
        quality: 0.78,
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

      setIsPreparing(true);
      let processedUri = asset.uri;
      let processedMimeType = mimeType;
      try {
        const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
        const manipulator = ImageManipulator.manipulate(asset.uri);
        if (Math.max(asset.width, asset.height) > 1800) {
          if (asset.width >= asset.height) {
            manipulator.resize({ width: 1800 });
          } else {
            manipulator.resize({ height: 1800 });
          }
        }
        const renderedImage = await manipulator.renderAsync();
        const processed = await renderedImage.saveAsync({
          compress: 0.78,
          format: SaveFormat.JPEG,
        });
        processedUri = processed.uri;
        processedMimeType = 'image/jpeg';
      } catch (manipulationError: unknown) {
        if (__DEV__) {
          console.info(
            '[TenantDocuments] Image resizing unavailable in the current native build; using picker compression.',
            manipulationError,
          );
        }
      }
      const processedFile = new ExpoFile(processedUri);
      const fileSize = processedFile.size;
      if (!Number.isFinite(fileSize) || fileSize <= 0) {
        setError('Could not determine the processed image size. Select it again.');
        return;
      }
      if (fileSize > TENANT_DOCUMENT_MAX_BYTES) {
        setError('The processed image is still larger than 5 MB. Try a lower-resolution photo.');
        return;
      }

      onChange({
        uri: processedUri,
        mimeType: processedMimeType,
        fileSize,
        file: processedFile,
      });
    } catch (selectionError: unknown) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : 'Could not select this image. Please try again.',
      );
    } finally {
      setIsPreparing(false);
      setIsPicking(false);
      if (__DEV__) {
        console.info(
          `[TenantDocuments] ${label} selection/processing: ${Date.now() - startedAt}ms`,
        );
      }
    }
  };

  const locked = disabled || isUploading || isPicking || isPreparing;
  const visibleState = isPreparing
    ? 'preparing'
    : isPicking
      ? 'idle'
      : progressState;
  const stateLabel = {
    idle: isPicking ? 'Opening picker' : '',
    preparing: 'Preparing photo',
    uploading: 'Uploading',
    done: 'Upload complete',
    failed: 'Upload failed',
  }[visibleState];

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
        {(isUploading || isPicking || isPreparing || visibleState === 'done' || visibleState === 'failed') && (
          <View style={styles.uploading}>
            {(isUploading || isPicking || isPreparing) && (
              <ActivityIndicator color="#2563EB" size="small" />
            )}
            <Text
              style={[
                styles.uploadingLabel,
                visibleState === 'done' && styles.successLabel,
                visibleState === 'failed' && styles.failedLabel,
              ]}>
              {stateLabel}
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
  successLabel: {
    color: '#1E3A8A',
    fontWeight: '600',
  },
  failedLabel: {
    color: '#B42318',
    fontWeight: '600',
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
