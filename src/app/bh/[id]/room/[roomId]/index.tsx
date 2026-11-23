import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AnimatedButton from '@/components/AnimatedButton';
import ImageField from '@/components/ImageField';
import RoomLabel from '@/components/RoomLabel';
import TenantEditModal from '@/components/TenantEditModal';
import { useBills } from '@/contexts/BillsContext';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { isOccupied, useRooms } from '@/contexts/RoomsContext';
import type { TenantDocumentImage, TenantDocumentKind } from '@/data/tenantDocuments';
import { formatPeso, formatShortDate, periodLabel, todayIso } from '@/utils/billing';
import {
  getRoomMeterReadings,
  type MeterReading,
} from '@/utils/meterReadings';

type RoomTab = 'info' | 'history';

export default function RoomDetailScreen() {
  const params = useLocalSearchParams<{ id: string; roomId: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    getRoomById,
    isLoading: isLoadingRooms,
    loadError: roomsError,
    refreshTenantDocument,
    reload: reloadRooms,
    replaceTenantDocument,
    archiveTenant,
  } = useRooms();
  const { getHouseById } = useBoardingHouses();
  const {
    getPaidBills,
    records,
    isLoading: isLoadingBills,
    loadError: billsError,
    reload: reloadBills,
    getLatestBillDueDate,
  } = useBills();
  const room = roomId ? getRoomById(roomId) : undefined;
  const houseName = room ? getHouseById(room.boardingHouseId)?.name : undefined;
  const tenantRoomId = room && isOccupied(room) ? room.id : null;

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
  const [documentsLoading, setDocumentsLoading] = useState<
    Partial<Record<TenantDocumentKind, boolean>>
  >({});
  const [meterReadings, setMeterReadings] = useState<MeterReading[]>([]);
  const [isLoadingMeterReadings, setIsLoadingMeterReadings] = useState(true);
  const [meterReadingsError, setMeterReadingsError] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [isEditingTenant, setIsEditingTenant] = useState(false);
  const [tenantUpdateNotice, setTenantUpdateNotice] = useState<string | null>(null);
  const refreshTenantDocumentRef = useRef(refreshTenantDocument);

  useEffect(() => {
    refreshTenantDocumentRef.current = refreshTenantDocument;
  }, [refreshTenantDocument]);

  useEffect(() => {
    if (!tenantUpdateNotice) return;
    const timeout = setTimeout(() => setTenantUpdateNotice(null), 4000);
    return () => clearTimeout(timeout);
  }, [tenantUpdateNotice]);

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
      const uri = await refreshTenantDocumentRef.current(roomId ?? '', kind);
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

  const refreshMeterReadings = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!roomId) return;
      setIsLoadingMeterReadings(true);
      setMeterReadingsError(null);
      try {
        const readings = await getRoomMeterReadings(roomId);
        if (isCurrent()) setMeterReadings(readings);
      } catch (error: unknown) {
        if (isCurrent()) {
          setMeterReadingsError(
            error instanceof Error ? error.message : 'Could not load meter readings.',
          );
        }
      } finally {
        if (isCurrent()) setIsLoadingMeterReadings(false);
      }
    },
    [roomId],
  );

  useEffect(() => {
    if (!tenantRoomId) return;
    let isCurrent = true;
    const kinds: TenantDocumentKind[] = ['id', 'agreement'];
    setDocumentsLoading({ id: true, agreement: true });
    setDocumentLoadErrors({});

    void Promise.allSettled(
      kinds.map(async (kind) => {
        try {
          const uri = await refreshTenantDocumentRef.current(tenantRoomId, kind);
          if (!uri) throw new Error('This document is unavailable.');
        } catch (error: unknown) {
          if (!isCurrent) return;
          setDocumentLoadErrors((current) => ({
            ...current,
            [kind]: error instanceof Error ? error.message : 'Could not load this document.',
          }));
        } finally {
          if (isCurrent) {
            setDocumentsLoading((current) => ({ ...current, [kind]: false }));
          }
        }
      }),
    );

    return () => {
      isCurrent = false;
    };
  }, [tenantRoomId]);

  useFocusEffect(
    useCallback(() => {
      let isCurrent = true;
      reloadBills();
      void refreshMeterReadings(() => isCurrent);
      return () => {
        isCurrent = false;
      };
    }, [refreshMeterReadings, reloadBills]),
  );

  if (!room) {
    if (isLoadingRooms) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color="#2563EB" size="large" />
        </View>
      );
    }

    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Room' }} />
        <Text style={styles.emptyText}>{roomsError ?? 'Room not found.'}</Text>
        {roomsError && (
          <Pressable onPress={reloadRooms} style={styles.retryButton}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const occupied = isOccupied(room);
  const tenant = occupied ? room.tenant : null;
  const tenantDueDate = tenant ? getLatestBillDueDate(room.id) : null;
  const paidBills = occupied ? getPaidBills(room.id) : [];
  const latestMeterReading = meterReadings[0];
  // Only tenants who have already moved in can be archived.
  const canArchive = !!tenant && tenant.startDate <= todayIso();

  const confirmArchive = async () => {
    if (isArchiving) return;
    setIsArchiving(true);
    setArchiveError(null);
    try {
      await archiveTenant(room.id);
      router.back();
    } catch (error: unknown) {
      setArchiveError(
        error instanceof Error ? error.message : 'Could not archive this tenant. Please try again.',
      );
      setIsArchiving(false);
    }
  };

  const handleArchive = () => {
    if (!tenant || isArchiving) return;
    const unpaid = Object.entries(records).filter(
      ([key, bill]) =>
        key.startsWith(`${room.id}|`) && bill.status === 'unpaid' && bill.billId !== null,
    );
    const outstanding = unpaid.reduce((sum, [, bill]) => sum + bill.totalAmount, 0);
    const warning = billsError
      ? '\n\nUnpaid bills could not be checked right now.'
      : unpaid.length > 0
        ? `\n\n${unpaid.length} unpaid ${unpaid.length === 1 ? 'bill' : 'bills'} (${formatPeso(outstanding)}) will stay in the archive.`
        : '';

    Alert.alert(
      'Archive tenant?',
      `${tenant.firstName} ${tenant.lastName}'s information and bill history will move to Archived, and ${room.roomName} will become vacant.${warning}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: () => void confirmArchive() },
      ],
    );
  };

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
              {tenant && (
                <View style={styles.tenantCardActionRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Edit tenant information"
                    onPress={() => {
                      setTenantUpdateNotice(null);
                      setIsEditingTenant(true);
                    }}
                    style={({ pressed }) => [
                      styles.editTenantButton,
                      pressed && styles.pressed,
                    ]}>
                    <Ionicons name="pencil" size={15} color="#2563EB" />
                    <Text style={styles.editTenantLabel}>Edit</Text>
                  </Pressable>
                </View>
              )}
              <InfoRow label="Room" value={room.roomName} />
              <InfoRow label="Status" value={occupied ? 'Occupied' : 'Vacant'} />
              <InfoRow label="Monthly rate" value={`${formatPeso(room.monthlyRate)} / month`} />
              {tenant && (
                <>
                  <InfoRow label="Tenant" value={`${tenant.firstName} ${tenant.lastName}`} />
                  <InfoRow label="Email" value={tenant.email} />
                  <InfoRow label="Contact" value={tenant.contactNumber} />
                  <InfoRow label="Start date" value={formatShortDate(tenant.startDate)} />
                  <View style={styles.infoDivider} />
                  <InfoRow
                    label="Due date"
                    value={
                      isLoadingBills
                        ? 'Loading…'
                        : tenantDueDate
                          ? formatShortDate(tenantDueDate)
                          : billsError
                            ? 'Unavailable'
                            : 'Not available'
                    }
                  />
                </>
              )}
            </View>
            {tenantUpdateNotice && (
              <View style={styles.tenantNotice} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle" size={18} color="#067647" />
                <Text style={styles.tenantNoticeText}>{tenantUpdateNotice}</Text>
              </View>
            )}

            {tenant ? (
              <>
                <PhotoCard
                  label="Valid ID"
                  uri={tenant.idImageUri}
                  loading={documentsLoading.id}
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
                  loading={documentsLoading.agreement}
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
            ) : (
              <View style={styles.vacantCard}>
                <Text style={styles.vacantText}>
                  This room is vacant. You can register a tenant when you are ready.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/bh/${room.boardingHouseId}/room/${room.id}/tenant`)}
                  style={styles.outlinedButton}>
                  <Text style={styles.outlinedButtonLabel}>Register tenant</Text>
                </Pressable>
              </View>
            )}

            <View style={styles.meterCard}>
              <View style={styles.meterHeading}>
                <View style={styles.meterIcon}>
                  <Ionicons name="flash" size={22} color="#2563EB" />
                </View>
                <Text style={styles.meterTitle}>Electricity meter</Text>
              </View>

              {isLoadingMeterReadings ? (
                <ActivityIndicator color="#2563EB" />
              ) : meterReadingsError ? (
                <View style={styles.meterState}>
                  <Text accessibilityLiveRegion="polite" style={styles.meterError}>
                    {meterReadingsError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void refreshMeterReadings()}
                    style={styles.retryButton}>
                    <Text style={styles.retryLabel}>Try again</Text>
                  </Pressable>
                </View>
              ) : latestMeterReading ? (
                <>
                  <View style={styles.latestReading}>
                    <Text style={styles.latestLabel}>Latest reading</Text>
                    <Text style={styles.latestValue}>
                      {latestMeterReading.value.toLocaleString(undefined, {
                        maximumFractionDigits: 20,
                      })}{' '}
                      kWh
                    </Text>
                    <Text style={styles.latestDate}>
                      {formatShortDate(latestMeterReading.readingAt)}
                    </Text>
                  </View>
                  {tenant && !meterReadings.some((reading) => reading.readingAt === tenant.startDate) ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push(
                          `/bh/${room.boardingHouseId}/room/${room.id}/meter-reading`,
                        )
                      }
                      style={styles.outlinedButton}>
                      <Text style={styles.outlinedButtonLabel}>Record move-in reading</Text>
                    </Pressable>
                  ) : occupied ? (
                    <Text style={styles.meterWarningText}>
                      Enter scheduled present readings from the Monthly Bill so usage is calculated
                      and attached to the correct bill.
                    </Text>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push(
                          `/bh/${room.boardingHouseId}/room/${room.id}/meter-reading`,
                        )
                      }
                      style={styles.outlinedButton}>
                      <Text style={styles.outlinedButtonLabel}>Record new reading</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push(
                        `/bh/${room.boardingHouseId}/room/${room.id}/meter-history`,
                      )
                    }
                    style={styles.historyLink}>
                    <Ionicons name="reader-outline" size={18} color="#1E3A8A" />
                    <Text style={styles.historyLinkLabel}>View reading history</Text>
                    <Ionicons name="chevron-forward" size={19} color="#64748B" />
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.noReadingText}>
                    No meter reading has been recorded yet.
                  </Text>
                  <View style={styles.meterWarning}>
                    <Ionicons name="information-circle-outline" size={18} color="#D97706" />
                    <Text style={styles.meterWarningText}>
                      A baseline is needed to calculate electricity consumption.
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push(
                        `/bh/${room.boardingHouseId}/room/${room.id}/meter-reading`,
                      )
                    }
                    style={styles.outlinedButton}>
                    <Text style={styles.outlinedButtonLabel}>
                      {occupied ? 'Record move-in reading' : 'Record meter reading'}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>

            {canArchive && (
              <View style={styles.archiveSection}>
                {archiveError && (
                  <Text accessibilityLiveRegion="polite" style={styles.archiveError}>
                    {archiveError}
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={isArchiving || isLoadingBills}
                  onPress={handleArchive}
                  style={[
                    styles.archiveButton,
                    (isArchiving || isLoadingBills) && styles.archiveButtonDisabled,
                  ]}>
                  {isArchiving ? (
                    <ActivityIndicator color="#B42318" />
                  ) : (
                    <>
                      <Ionicons name="archive-outline" size={18} color="#B42318" />
                      <Text style={styles.archiveButtonLabel}>Archive tenant</Text>
                    </>
                  )}
                </Pressable>
                <Text style={styles.archiveHint}>
                  Moves this tenant and their history to Archived and sets the room to vacant.
                </Text>
              </View>
            )}
          </>
        ) : !occupied ? (
          <Text style={styles.emptyText}>No tenant billing history is available for this room yet.</Text>
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
                <RoomLabel
                  boardingHouseName={houseName}
                  roomName={room.roomName}
                  style={styles.historyRoomLabel}
                />
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

      {isEditingTenant && tenant && (
        <TenantEditModal
          key={`${tenant.id}:${tenant.tenancyId}`}
          roomId={room.id}
          tenant={tenant}
          onCancel={() => setIsEditingTenant(false)}
          onSaved={() => {
            setIsEditingTenant(false);
            setTenantUpdateNotice('Tenant information updated.');
          }}
        />
      )}

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
  loading,
  onPress,
  onReplace,
  onError,
  onLoad,
  onRetry,
}: {
  label: string;
  uri: string;
  error?: string;
  loading?: boolean;
  onPress: (uri: string) => void;
  onReplace: () => void;
  onError: () => void;
  onLoad: () => void;
  onRetry: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.photoLabel}>{label}</Text>
      {loading ? (
        <View style={[styles.photo, styles.photoLoading]}>
          <ActivityIndicator color="#2563EB" />
          <Text style={styles.photoHint}>Loading document…</Text>
        </View>
      ) : uri ? (
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
  tenantCardActionRow: {
    alignItems: 'flex-end',
    marginBottom: -2,
  },
  editTenantButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 11,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
  },
  editTenantLabel: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  tenantNotice: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    backgroundColor: '#F0FDF4',
  },
  tenantNoticeText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '600',
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
  vacantCard: {
    padding: 16,
    gap: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  vacantText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
  },
  meterCard: {
    padding: 16,
    gap: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  meterHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  meterIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
  },
  meterTitle: {
    color: '#1E3A8A',
    fontSize: 17,
    fontWeight: '700',
  },
  meterState: {
    alignItems: 'center',
    gap: 10,
  },
  meterError: {
    color: '#B42318',
    fontSize: 13,
    textAlign: 'center',
  },
  latestReading: {
    padding: 14,
    gap: 4,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
  },
  latestLabel: {
    color: '#475569',
    fontSize: 13,
  },
  latestValue: {
    color: '#1E3A8A',
    fontSize: 23,
    fontWeight: '700',
  },
  latestDate: {
    color: '#64748B',
    fontSize: 13,
  },
  noReadingText: {
    color: '#334155',
    fontSize: 14,
  },
  meterWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FFF7E6',
  },
  meterWarningText: {
    flex: 1,
    color: '#7C4A03',
    fontSize: 12,
    lineHeight: 17,
  },
  outlinedButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#2563EB',
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
  },
  outlinedButtonLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '700',
  },
  historyLink: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  historyLinkLabel: {
    flex: 1,
    color: '#1E3A8A',
    fontSize: 13,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
  },
  infoDivider: {
    height: 1,
    marginVertical: 2,
    backgroundColor: '#D1D5DB',
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
  photoLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
  historyRoomLabel: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
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
  archiveSection: {
    gap: 8,
    marginTop: 8,
  },
  archiveButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#B42318',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  archiveButtonDisabled: {
    opacity: 0.5,
  },
  archiveButtonLabel: {
    color: '#B42318',
    fontSize: 15,
    fontWeight: '700',
  },
  archiveHint: {
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'center',
  },
  archiveError: {
    color: '#B42318',
    fontSize: 13,
    textAlign: 'center',
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