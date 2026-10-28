import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBills } from '@/contexts/BillsContext';
import { isOccupied, useRooms } from '@/contexts/RoomsContext';
import { formatPeso, formatShortDate, periodLabel } from '@/utils/billing';

type RoomTab = 'info' | 'history';

export default function RoomDetailScreen() {
  const params = useLocalSearchParams<{ id: string; roomId: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getRoomById } = useRooms();
  const { getPaidBills } = useBills();
  const room = roomId ? getRoomById(roomId) : undefined;

  const [tab, setTab] = useState<RoomTab>('info');
  const [viewerUri, setViewerUri] = useState<string | null>(null);

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

            <PhotoCard label="Valid ID" uri={tenant.idImageUri} onPress={setViewerUri} />
            <PhotoCard label="Contract" uri={tenant.contractImageUri} onPress={setViewerUri} />
          </>
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
        onRequestClose={() => setViewerUri(null)}
      >
        <Pressable style={styles.viewer} onPress={() => setViewerUri(null)}>
          {viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImage} />}
          <View style={[styles.viewerClose, { top: insets.top + 12 }]}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </View>
        </Pressable>
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
  onPress,
}: {
  label: string;
  uri: string;
  onPress: (uri: string) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.photoLabel}>{label}</Text>
      <Pressable
        onPress={() => onPress(uri)}
        accessibilityRole="imagebutton"
        accessibilityLabel={`View ${label} photo`}
      >
        <Image source={{ uri }} style={styles.photo} />
      </Pressable>
      <Text style={styles.photoHint}>Tap to view full size</Text>
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
  photoHint: {
    color: '#6B7280',
    fontSize: 12,
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