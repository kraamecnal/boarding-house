import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import BillStatement from '@/components/BillStatement';
import { useBills } from '@/contexts/BillsContext';
import { useRooms } from '@/contexts/RoomsContext';
import { buildBillText, currentPeriod, periodLabel, shiftPeriod } from '@/utils/billing';

export default function TenantBillScreen() {
  const params = useLocalSearchParams<{ roomId: string; period?: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const requestedPeriod = Array.isArray(params.period) ? params.period[0] : params.period;

  const { getRoomById } = useRooms();
  const { getBill, setElectricity, setStatus } = useBills();
  const room = roomId ? getRoomById(roomId) : undefined;

  const minPeriod = room ? room.startDate.slice(0, 7) : currentPeriod();
  const thisMonth = currentPeriod();
  const maxPeriod = thisMonth >= minPeriod ? thisMonth : minPeriod;

  const initialPeriod =
    requestedPeriod && requestedPeriod >= minPeriod && requestedPeriod <= maxPeriod
      ? requestedPeriod
      : maxPeriod;
  const [period, setPeriod] = useState(initialPeriod);

  if (!room) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyText}>Tenant not found.</Text>
      </View>
    );
  }

  const record = getBill(room.id, period);
  const canGoBack = period > minPeriod;
  const canGoForward = period < maxPeriod;

  const handleShare = async () => {
    try {
      await Share.share({
        message: buildBillText({
          room,
          period: record.period,
          issuedDate: record.issuedDate,
          dueDate: record.dueDate,
          electricity: record.electricity,
          status: record.status,
        }),
      });
    } catch {
      Alert.alert('Could not share', 'Something went wrong while sharing this bill.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Month picker */}
        <View style={styles.periodRow}>
          <Pressable
            onPress={() => setPeriod(shiftPeriod(period, -1))}
            disabled={!canGoBack}
            hitSlop={12}
            accessibilityLabel="Previous month"
          >
            <Ionicons
              name="chevron-back"
              size={26}
              color={canGoBack ? '#1A2B3C' : '#D0D5DD'}
            />
          </Pressable>
          <Text style={styles.periodText}>{periodLabel(period)}</Text>
          <Pressable
            onPress={() => setPeriod(shiftPeriod(period, 1))}
            disabled={!canGoForward}
            hitSlop={12}
            accessibilityLabel="Next month"
          >
            <Ionicons
              name="chevron-forward"
              size={26}
              color={canGoForward ? '#1A2B3C' : '#D0D5DD'}
            />
          </Pressable>
        </View>

        <Text style={styles.hint}>
          Type this month's electricity in the Electricity box. The total updates as you type.
        </Text>

        <BillStatement
          room={room}
          record={record}
          onChangeElectricity={(text) => setElectricity(room.id, period, text)}
          onChangeStatus={(status) => setStatus(room.id, period, status)}
        />

        <Pressable style={styles.shareButton} onPress={handleShare}>
          <Ionicons name="share-outline" size={18} color="#007AFF" />
          <Text style={styles.shareText}>Share bill</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 48,
    backgroundColor: '#f8f9fa',
    gap: 14,
    flexGrow: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
  },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  periodText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A2B3C',
  },
  hint: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  shareText: {
    color: '#007AFF',
    fontSize: 15,
    fontWeight: '500',
  },
});
