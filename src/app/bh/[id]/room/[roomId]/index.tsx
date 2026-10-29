import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AnimatedButton from '@/components/AnimatedButton';
import ImageField from '@/components/ImageField';
import { useBills } from '@/contexts/BillsContext';
import { isOccupied, useRooms } from '@/contexts/RoomsContext';
import type { TenantDocumentImage, TenantDocumentKind } from '@/data/tenantDocuments';
import { formatPeso, formatShortDate, periodLabel } from '@/utils/billing';

type RoomTab = 'info' | 'history';

export default function RoomDetailScreen() {
  const params = useLocalSearchParams<{ id: string; roomId: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    getRoomById,
    refreshTenantDocument,
    replaceTenantDocument,
  } = useRooms();
  const { getPaidBills, isLoading: isLoadingBills, loadError: billsError, reload: reloadBills } = useBills();
  const room = roomId ? getRoomById(roomId) : undefined;

  const [tab, setTab] = useState<RoomTab>('info');
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerDocumentKind, setViewerDocumentKind] = useState<TenantDocumentKind | null>(null);
  const [editingDocument, setEditingDocument] = useState<TenantDocumentKind | null>(null);
  const [replacementImage, setReplacementImage] = useState<TenantDocumentImage | null>(null);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const [replacementNotice, setReplacementNotice] = useState<string | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const [documentRetryCount, setDocumentRetryCount] = useState<
    Partial<Record<TenantDocumentKind, number>>
  >({});
  const [documentLoadErrors, setDocumentLoadErrors] = useState<
    Partial<Record<TenantDocumentKind, string>>
  >({});

  const retryDocument = async (kind: TenantDocumentKind, force = false) => {
    if (!force && (documentRetryCount[kind] ?? 0) >= 1) {
      setDocumentLoadErrors((current) => ({
        ...current,
        [kind]: 'Could not load this document. Try again or replace it.',
      }));
      return;
    }

    setDocumentRetryCount((current) => ({
      ...current,
      [kind]: force ? 1 : (current[kind] ?? 0) + 1,
    }));
    try {
      const uri = await refreshTenantDocument(roomId ?? '', kind);
      if (!uri) {
        setDocumentLoadErrors((current) => ({
          ...current,
          [kind]: 'This document is unavailable. You can replace it with a new photo.',
        }));
      } else {
        setDocumentLoadErrors((current) => ({ ...current, [kind]: undefined }));
        if (viewerDocumentKind === kind) setViewerUri(uri);
      }
    } catch (error: unknown) {
      setDocumentLoadErrors((current) => ({
        ...current,
        [kind]: error instanceof Error ? error.message : 'Could not load this document.',
      }));
    }
  };

  const saveReplacement = async () => {
    if (!roomId || !editingDocument || !replacementImage || isReplacing) return;
    setIsReplacing(true);
    setReplacementError(null);
    setReplacementNotice(null);
    try {
      const notice = await replaceTenantDocument(roomId, editingDocument, replacementImage);
      setReplacementNotice(notice);
      setEditingDocument(null);
      setReplacementImage(null);
    } catch (error: unknown) {
      setReplacementError(
        error instanceof Error ? error.message : 'Could not replace this document. Please try again.',
      );
    } finally {
      setIsReplacing(false);
    }
  };

  const openReplaceModal = (kind: TenantDocumentKind) => {
    setEditingDocument(kind);
    setReplacementImage(null);
    setReplacementError(null);
    setReplacementNotice(null);
  };

  if (!room || !isOccupied(room)) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: room?.roomName ?? 'Room' }} />
        <Text style={styles.emptyText}>
          {room ? `${room.roomName} has no tenant yet.` : 'Room not found.'}
        </Text>
      </View>
    );
  }

  const { tenant } = room;
  const paidBills = getPaidBills(room.id);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: room.roomName }} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.tabs} accessibilityRole="tablist">
          <SectionTab
            label="Tenant's Information"
            selected={tab === 'info'}
            onPress={() => setTab('info')}
          />
          <SectionTab
            label="History"
            selected={tab === 'history'}
            onPress={() => setTab('history')}
          />
        </View>

        {tab === 'info' ? (
          <>
            <View style={styles.card}>
              <InfoRow label="Room" value={room.roomName} />
              <InfoRow label="Monthly rate" value={`${formatPeso(room.monthlyRate)} / month`} />
              <InfoRow label="Tenant" value={`${tenant.firstName} ${tenant.lastName}`} />
              <InfoRow label="Email" value={tenant.email} />
              <InfoRow label="Contact" value={tenant.contactNumber} />
              <InfoRow label="Start date" value={formatShortDate(tenant.startDate)} />
              <InfoRow label="Due date" value={formatShortDate(tenant.dueDate)} />
            </View>

            <PhotoCard
              label="Valid ID"
              uri={tenant.idImageUri}
              error={documentLoadErrors.id}
              onPress={(uri) => {
                setViewerDocumentKind('id');
                setViewerUri(uri);
              }}
              onReplace={() => openReplaceModal('id')}
              onError={() => void retryDocument('id')}
              onLoad={() => {
                setDocumentRetryCount((current) => ({ ...current, id: 0 }));
                setDocumentLoadErrors((current) => ({ ...current, id: undefined }));
              }}
              onRetry={() => void retryDocument('id', true)}
            />
            <PhotoCard
              label="Contract"
              uri={tenant.contractImageUri}
              error={documentLoadErrors.agreement}
              onPress={(uri) => {
                setViewerDocumentKind('agreement');
                setViewerUri(uri);
              }}
              onReplace={() => openReplaceModal('agreement')}
              onError={() => void retryDocument('agreement')}
              onLoad={() => {
                setDocumentRetryCount((current) => ({ ...current, agreement: 0 }));
                setDocumentLoadErrors((current) => ({ ...current, agreement: undefined }));
              }}
              onRetry={() => void retryDocument('agreement', true)}
            />
            {replacementNotice && (
              <Text accessibilityLiveRegion="polite" style={styles.replacementNotice}>
                {replacementNotice}
              </Text>
            )}
          </>
        ) : isLoadingBills ? (
          <ActivityIndicator color="#2563EB" size="large" />
        ) : billsError ? (
          <View style={styles.historyError}>
            <Text style={styles.emptyText}>{billsError}</Text>
            <Pressable onPress={reloadBills} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : paidBills.length === 0 ? (
          <Text style={styles.emptyText}>
            No paid bills yet.{'\n'}Paid bills will appear here.
          </Text>
        ) : (
          paidBills.map((bill) => (
            <Pressable
              key={bill.period}
              onPress={() => router.push(`/bill/${room.id}?period=${bill.period}`)}
              style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Open paid ${periodLabel(bill.period)} bill`}
            >
              <View style={styles.historyCopy}>
                <Text style={styles.historyTitle}>{periodLabel(bill.period)} bill</Text>
                <Text style={styles.historyDetail}>Paid on {formatShortDate(bill.paidDate)}</Text>
              </View>
              <Text style={styles.historyAmount}>{formatPeso(bill.snapshot.total)}</Text>
              <Ionicons name="chevron-forward" size={20} color="#8A94A6" />
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal
        visible={viewerUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setViewerUri(null);
          setViewerDocumentKind(null);
        }}
      >
        <Pressable
          style={styles.viewer}
          onPress={() => {
            setViewerUri(null);
            setViewerDocumentKind(null);
          }}>
          {viewerUri && (
            <Image
              source={{ uri: viewerUri }}
              style={styles.viewerImage}
              onError={() => viewerDocumentKind && void retryDocument(viewerDocumentKind)}
              onLoad={() => {
                if (!viewerDocumentKind) return;
                setDocumentRetryCount((current) => ({ ...current, [viewerDocumentKind]: 0 }));
                setDocumentLoadErrors((current) => ({ ...current, [viewerDocumentKind]: undefined }));
              }}
            />
          )}
          <View style={[styles.viewerClose, { top: insets.top + 12 }]}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={editingDocument !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!isReplacing) setEditingDocument(null);
        }}>
        <View style={styles.editOverlay}>
          <View style={styles.editCard}>
            <Text style={styles.editTitle}>
              Replace {editingDocument === 'id' ? 'Valid ID' : 'Contract'}
            </Text>
            <ImageField
              label={editingDocument === 'id' ? 'New valid ID photo' : 'New contract photo'}
              image={replacementImage}
              onChange={setReplacementImage}
              placeholder="Choose or take a new document photo"
              disabled={isReplacing}
              isUploading={isReplacing}
            />
            {replacementError && (
              <Text accessibilityLiveRegion="polite" style={styles.replacementError}>
                {replacementError}
              </Text>
            )}
            <View style={styles.editActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isReplacing}
                onPress={() => setEditingDocument(null)}
                style={styles.cancelEditButton}>
                <Text style={styles.cancelEditLabel}>Cancel</Text>
              </Pressable>
              <View style={styles.saveEditButton}>
                <AnimatedButton
                  disabled={!replacementImage || isReplacing}
                  label={isReplacing ? 'Saving…' : 'Save replacement'}
                  onPress={() => void saveReplacement()}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SectionTab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.selectedTab]}
    >
      <Text style={[styles.tabLabel, selected && styles.selectedTabLabel]}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function PhotoCard({
  label,
  uri,
  error,
  onPress,
  onReplace,
  onError,
  onLoad,
  onRetry,
}: {
  label: string;
  uri: string;
  error?: string;
  onPress: (uri: string) => void;
  onReplace: () => void;
  onError: () => void;
  onLoad: () => void;
  onRetry: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.photoLabel}>{label}</Text>
      {uri ? (
        <Pressable
          onPress={() => onPress(uri)}
          accessibilityRole="imagebutton"
          accessibilityLabel={`View ${label} photo`}>
          <Image
            source={{ uri }}
            style={styles.photo}
            onError={onError}
            onLoad={onLoad}
          />
        </Pressable>
      ) : (
        <View style={[styles.photo, styles.photoUnavailable]}>
          <Text style={styles.photoHint}>Document unavailable</Text>
        </View>
      )}
      {error && (
        <View style={styles.documentErrorRow}>
          <Text style={styles.documentError}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      )}
      {uri && <Text style={styles.photoHint}>Tap to view full size</Text>}
      <Pressable accessibilityRole="button" onPress={onReplace} style={styles.replaceDocumentButton}>
        <Text style={styles.replaceDocumentLabel}>Replace document</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    backgroundColor: '#f8f9fa',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 12,
    flexGrow: 1,
  },
  emptyText: {
    marginTop: 40,
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
  },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: 10,
    backgroundColor: '#E4E7EC',
  },
  tab: {
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  selectedTab: {
    backgroundColor: '#FFFFFF',
  },
  tabLabel: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
  },
  selectedTabLabel: {
    color: '#1A2B3C',
  },
  card: {
    padding: 16,
    gap: 10,
    borderRadius: 12,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  infoLabel: {
    width: 100,
    color: '#6B7280',
    fontSize: 14,
  },
  infoValue: {
    flex: 1,
    color: '#1A2B3C',
    fontSize: 14,
    fontWeight: '600',
  },
  photoLabel: {
    color: '#1A2B3C',
    fontSize: 14,
    fontWeight: '700',
  },
  photo: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    backgroundColor: '#F7F8FA',
    resizeMode: 'cover',
  },
  photoUnavailable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoHint: {
    color: '#6B7280',
    fontSize: 12,
  },
  replaceDocumentButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
  },
  replaceDocumentLabel: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  documentErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  documentError: {
    flex: 1,
    color: '#B42318',
    fontSize: 13,
  },
  replacementNotice: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
  },
  replacementError: {
    color: '#B42318',
    fontSize: 13,
  },
  editOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  editCard: {
    maxHeight: '90%',
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  editTitle: {
    color: '#1E3A8A',
    fontSize: 20,
    fontWeight: '700',
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
  },
  cancelEditButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  cancelEditLabel: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
  saveEditButton: {
    flex: 1,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  pressed: {
    opacity: 0.85,
  },
  historyCopy: {
    flex: 1,
    gap: 2,
  },
  historyTitle: {
    color: '#1A2B3C',
    fontSize: 16,
    fontWeight: '700',
  },
  historyDetail: {
    color: '#067647',
    fontSize: 13,
    fontWeight: '600',
  },
  historyAmount: {
    color: '#1A2B3C',
    fontSize: 15,
    fontWeight: '700',
  },
  historyError: {
    alignItems: 'center',
    gap: 12,
    padding: 18,
  },
  retryButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
  },
  retryLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  viewer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  viewerClose: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});