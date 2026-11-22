import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DashboardColors } from '@/constants/theme';
import RoomLabel from '@/components/RoomLabel';
import { useAuth } from '@/contexts/AuthContext';
import { useBoardingHouses } from '@/contexts/BoardingHousesContext';
import { useRooms } from '@/contexts/RoomsContext';
import { getSupabaseClient } from '@/utils/supabase';

type TenantStatus = 'active' | 'scheduled' | 'archived';
type TenantRow = {
  key: string;
  name: string;
  roomName: string;
  boardingHouseName: string;
  roomId?: string;
  moveInDate: string | null;
  moveOutDate: string | null;
  boardingHouseId?: string;
  archiveId?: string;
};

type TenantSearchRow = {
  record_id: string;
  tenant_name: string;
  room_name: string | null;
  boarding_house_name: string | null;
  room_id: string | null;
  boarding_house_id: string | null;
  move_in_date: string | null;
  move_out_date: string | null;
  total_count: number;
};

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 275;
const STATUS_OPTIONS: { value: TenantStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'archived', label: 'Archived' },
];

function formatDate(value: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function normalizeSearch(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function logTenantLoadError(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const details = {
      code: 'code' in error ? error.code : undefined,
      message: 'message' in error ? error.message : undefined,
      details: 'details' in error ? error.details : undefined,
      hint: 'hint' in error ? error.hint : undefined,
    };
    console.error('Could not load tenant search results.', details);
    return;
  }
  console.error('Could not load tenant search results.', error);
}

export default function TenantsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { boardingHouses } = useBoardingHouses();
  const { rooms } = useRooms();
  const [status, setStatus] = useState<TenantStatus>('active');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const requestVersion = useRef(0);
  const currentHouseNames = useMemo(
    () => new Map(boardingHouses.map((house) => [house.id, house.name])),
    [boardingHouses],
  );
  const currentRoomNames = useMemo(
    () => new Map(rooms.map((room) => [room.id, room.roomName])),
    [rooms],
  );

  useEffect(() => {
    const nextSearch = normalizeSearch(search);
    if (!nextSearch) {
      setDebouncedSearch('');
      return;
    }

    const timeout = setTimeout(() => setDebouncedSearch(nextSearch), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let isCurrent = true;
    const currentRequest = ++requestVersion.current;

    const loadTenants = async () => {
      setIsLoading(true);
      setLoadError(null);

      if (!session?.user.id) {
        setTenants([]);
        setPageCount(1);
        setLoadError('Your signed-in owner account could not be identified.');
        setIsLoading(false);
        return;
      }

      try {
        const client = getSupabaseClient();
        const from = (page - 1) * PAGE_SIZE;
        const { data, error } = await client.rpc('search_tenant_list', {
          p_status: status,
          p_search: debouncedSearch,
          p_offset: from,
          p_limit: PAGE_SIZE,
        });
        if (error) throw error;

        const resultRows = (data ?? []) as TenantSearchRow[];
        const rows = resultRows.map((row) => ({
          key: row.record_id,
          archiveId: status === 'archived' ? row.record_id : undefined,
          name: row.tenant_name,
          roomName: row.room_name ?? 'Room unavailable',
          boardingHouseName: row.boarding_house_name ?? 'Boarding house unavailable',
          moveInDate: row.move_in_date,
          moveOutDate: row.move_out_date,
          roomId: row.room_id ?? undefined,
          boardingHouseId: row.boarding_house_id ?? undefined,
        }));
        const count = resultRows[0]?.total_count ?? 0;

        if (!isCurrent || currentRequest !== requestVersion.current) return;
        setTenants(rows);
        setPageCount(Math.max(1, Math.ceil(count / PAGE_SIZE)));
      } catch (error: unknown) {
        if (!isCurrent || currentRequest !== requestVersion.current) return;
        logTenantLoadError(error);
        setTenants([]);
        setPageCount(1);
        setLoadError('Could not load tenants. Please try again.');
      } finally {
        if (isCurrent && currentRequest === requestVersion.current) setIsLoading(false);
      }
    };

    void loadTenants();
    return () => {
      isCurrent = false;
    };
  }, [debouncedSearch, loadAttempt, page, session?.user.id, status]);

  const selectStatus = (nextStatus: TenantStatus) => {
    if (nextStatus === status) return;
    requestVersion.current += 1;
    setIsLoading(true);
    setLoadError(null);
    setStatus(nextStatus);
    setPage(1);
  };

  const openTenant = (tenant: TenantRow) => {
    if (tenant.archiveId) router.push(`/archived/${tenant.archiveId}`);
    else if (tenant.boardingHouseId) router.push(`/bh/${tenant.boardingHouseId}`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <Ionicons color={DashboardColors.neutral} name="search-outline" size={20} />
        <TextInput
          accessibilityLabel="Search tenants"
          autoCapitalize="none"
          onChangeText={(value) => {
            requestVersion.current += 1;
            if (normalizeSearch(value) !== debouncedSearch) {
              setIsLoading(true);
              setLoadError(null);
            }
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search tenant, room, or boarding house..."
          placeholderTextColor="#94A3B8"
          returnKeyType="search"
          style={styles.searchInput}
          value={search}
        />
      </View>

      <View accessibilityRole="tablist" style={styles.filters}>
        {STATUS_OPTIONS.map((option) => {
          const selected = status === option.value;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => selectStatus(option.value)}
              style={[styles.filter, selected && styles.filterSelected]}>
              <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View accessibilityLiveRegion="polite" style={styles.stateCard}>
          <ActivityIndicator color={DashboardColors.primary} size="large" />
          <Text style={styles.stateText}>Loading tenants…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.stateCard}>
          <Ionicons color="#B42318" name="alert-circle-outline" size={28} />
          <Text accessibilityLiveRegion="polite" style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={() => setLoadAttempt((attempt) => attempt + 1)} style={styles.retryButton}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : tenants.length === 0 ? (
        <View style={styles.stateCard}>
          <Ionicons color={DashboardColors.neutral} name="people-outline" size={32} />
          <Text style={styles.stateText}>
            {debouncedSearch
              ? `No tenants found for '${debouncedSearch}'.`
              : 'No tenants match this view.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {tenants.map((tenant) => (
            <Pressable
              accessibilityRole="button"
              key={tenant.key}
              onPress={() => openTenant(tenant)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
              <View style={styles.cardHeader}>
                <Text numberOfLines={1} style={styles.tenantName}>{tenant.name}</Text>
                {(tenant.boardingHouseId || tenant.archiveId) && (
                  <Ionicons color={DashboardColors.primary} name="chevron-forward" size={20} />
                )}
              </View>
              <RoomLabel
                boardingHouseName={
                  tenant.boardingHouseId
                    ? (currentHouseNames.get(tenant.boardingHouseId) ?? tenant.boardingHouseName)
                    : tenant.boardingHouseName
                }
                roomName={
                  tenant.roomId
                    ? (currentRoomNames.get(tenant.roomId) ?? tenant.roomName)
                    : tenant.roomName
                }
                style={styles.roomName}
              />
              <Text style={styles.dateText}>
                {status === 'scheduled' ? 'Move-in: ' : 'Moved in: '}{formatDate(tenant.moveInDate)}
              </Text>
              {status === 'archived' && (
                <Text style={styles.dateText}>Moved out: {formatDate(tenant.moveOutDate)}</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}

      {!isLoading && !loadError && tenants.length > 0 && pageCount > 1 && (
        <View accessibilityRole="toolbar" style={styles.pagination}>
          <Pressable
            accessibilityLabel="Previous page"
            accessibilityRole="button"
            disabled={page === 1}
            onPress={() => setPage((current) => Math.max(1, current - 1))}
            style={[styles.pageButton, page === 1 && styles.pageButtonDisabled]}>
            <Ionicons color={page === 1 ? '#94A3B8' : DashboardColors.dark} name="arrow-back" size={20} />
          </Pressable>
          <Text style={styles.pageNumber}>{page}</Text>
          <Pressable
            accessibilityLabel="Next page"
            accessibilityRole="button"
            disabled={page === pageCount}
            onPress={() => setPage((current) => Math.min(pageCount, current + 1))}
            style={[styles.pageButton, page === pageCount && styles.pageButtonDisabled]}>
            <Ionicons color={page === pageCount ? '#94A3B8' : DashboardColors.dark} name="arrow-forward" size={20} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DashboardColors.white,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  searchRow: {
    minHeight: 48,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
  },
  searchInput: { flex: 1, color: DashboardColors.text, fontSize: 15 },
  filters: { flexDirection: 'row', gap: 8, paddingVertical: 12 },
  filter: {
    minHeight: 40,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: DashboardColors.border,
    borderRadius: 20,
    backgroundColor: DashboardColors.pale,
  },
  filterSelected: { borderColor: DashboardColors.primary, backgroundColor: DashboardColors.primary },
  filterLabel: { color: DashboardColors.dark, fontSize: 14, fontWeight: '700' },
  filterLabelSelected: { color: DashboardColors.white },
  list: { gap: 12, paddingBottom: 16 },
  card: {
    minHeight: 116,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: DashboardColors.border,
    borderRadius: 14,
    backgroundColor: DashboardColors.white,
  },
  cardPressed: { backgroundColor: DashboardColors.pale },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tenantName: { flex: 1, color: DashboardColors.dark, fontSize: 17, fontWeight: '700' },
  roomName: { color: DashboardColors.text, fontSize: 15, fontWeight: '600' },
  dateText: { color: DashboardColors.neutral, fontSize: 13 },
  stateCard: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stateText: { color: DashboardColors.neutral, fontSize: 15, textAlign: 'center' },
  errorText: { color: '#B42318', fontSize: 14, textAlign: 'center' },
  retryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderRadius: 10, backgroundColor: DashboardColors.pale },
  retryLabel: { color: DashboardColors.primary, fontSize: 14, fontWeight: '700' },
  pagination: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, paddingBottom: 8 },
  pageButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DashboardColors.border, borderRadius: 22 },
  pageButtonDisabled: { borderColor: '#E2E8F0' },
  pageNumber: { minWidth: 24, color: DashboardColors.dark, fontSize: 15, fontWeight: '700', textAlign: 'center' },
});