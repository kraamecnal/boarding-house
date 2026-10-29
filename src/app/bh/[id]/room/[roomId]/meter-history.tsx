import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRooms } from '@/contexts/RoomsContext';
import { formatShortDate } from '@/utils/billing';
import {
  getRoomMeterReadings,
  meterReadingErrorMessage,
  type MeterReading,
} from '@/utils/meterReadings';

export default function MeterReadingHistoryScreen() {
  const params = useLocalSearchParams<{ roomId: string }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const { getRoomById, isLoading: isLoadingRooms } = useRooms();
  const room = roomId ? getRoomById(roomId) : undefined;
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!roomId) return;
    let isCurrent = true;

    void getRoomMeterReadings(roomId)
      .then((result) => {
        if (isCurrent) setReadings(result);
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setError(meterReadingErrorMessage(loadError, 'Could not load meter reading history.'));
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [loadAttempt, roomId]);

  const initialReadingId = readings[readings.length - 1]?.id;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Meter Reading History' }} />
      {isLoadingRooms && !room ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#2563EB" size="large" />
        </View>
      ) : !room ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Room not found.</Text>
        </View>
      ) : !roomId ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Room not found.</Text>
        </View>
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#2563EB" size="large" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={30} color="#B42318" />
          <Text accessibilityLiveRegion="polite" style={styles.emptyText}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setIsLoading(true);
              setError(null);
              setLoadAttempt((attempt) => attempt + 1);
            }}
            style={styles.retryButton}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : readings.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="flash-outline" size={34} color="#2563EB" />
          <Text style={styles.emptyText}>No meter readings have been recorded for {room.roomName}.</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={readings}
          keyExtractor={(reading) => reading.id}
          renderItem={({ item }) => (
            <View style={styles.readingCard}>
              <View style={styles.readingCopy}>
                <Text style={styles.readingValue}>
                  {item.value.toLocaleString(undefined, { maximumFractionDigits: 20 })} kWh
                </Text>
                <Text style={styles.readingDate}>{formatShortDate(item.readingAt)}</Text>
              </View>
              {item.id === initialReadingId ? (
                <View style={styles.initialBadge}>
                  <Text style={styles.initialLabel}>Initial</Text>
                </View>
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  list: {
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  readingCard: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  readingCopy: {
    flex: 1,
    gap: 4,
  },
  readingValue: {
    color: '#1E293B',
    fontSize: 15,
    fontWeight: '700',
  },
  readingDate: {
    color: '#64748B',
    fontSize: 13,
  },
  initialBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#EFF6FF',
  },
  initialLabel: {
    color: '#1E3A8A',
    fontSize: 11,
    fontWeight: '700',
  },
  retryButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
  },
  retryLabel: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '700',
  },
});
