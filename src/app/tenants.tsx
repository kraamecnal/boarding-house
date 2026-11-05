import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { useAuth } from '@/contexts/AuthContext';
import { getSupabaseClient } from '@/utils/supabase';

type TenantStatus = 'active' | 'scheduled' | 'archived';
type TenantRow = {
  key: string;
  name: string;
  roomName: string;
  moveInDate: string | null;
  moveOutDate: string | null;
  boardingHouseId?: string;
  archiveId?: string;
};

const PAGE_SIZE = 10;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load tenants. Please try again.';
}

function getRelatedRecord<T extends object>(
  relation: T | T[] | null | undefined,
): T | undefined {
  return Array.isArray(relation) ? relation[0] : relation ?? undefined;
}

export default function TenantsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [status, setStatus] = useState<TenantStatus>('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;

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
        const ownerId = session.user.id;
        const query = search.trim();
        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        let rows: TenantRow[] = [];
        let count = 0;

        if (status === 'archived') {
          let archivedQuery = client
            .from('tenant_archive')
            .select(
              'archive_id, tenant_name, room_name, move_in_date, move_out_date',
              { count: 'exact' },
            )
            .eq('owner_id', ownerId);

          if (query) {
            const term = query.replaceAll(',', '\\,');
            archivedQuery = archivedQuery.or(
              `tenant_name.ilike.%${term}%,room_name.ilike.%${term}%`,
            );
          }

          const { data, count: resultCount, error } = await archivedQuery
            .order('move_out_date', { ascending: false })
            .range(from, to);
          if (error) throw error;
          count = resultCount ?? 0;
          rows = (data ?? []).map((row) => ({
            key: row.archive_id,
            archiveId: row.archive_id,
            name: row.tenant_name,
            roomName: row.room_name ?? 'Room unavailable',
            moveInDate: row.move_in_date,
            moveOutDate: row.move_out_date,
          }));
        } else {
          let tenancyQuery = client
            .from('tenancy')
            .select(
              'tenancy_id, move_in_date, tenants(tenant_id,name), rooms(room_id,room_name,boarding_house_id)',
              { count: 'exact' },
            )
            .eq('owner_id', ownerId)
            .eq('status', status);

          if (query) {
            const term = query.replaceAll(',', '\\,');
            tenancyQuery = tenancyQuery.or(
              `tenants.name.ilike.%${term}%,rooms.room_name.ilike.%${term}%`,
            );
          }

          const { data, count: resultCount, error } = await tenancyQuery
            .order('move_in_date', { ascending: status === 'scheduled' })
            .range(from, to);
          if (error) throw error;
          count = resultCount ?? 0;
          rows = (data ?? []).map((row) => {
            const tenant = getRelatedRecord(row.tenants);
            const room = getRelatedRecord(row.rooms);
            return {
              key: row.tenancy_id,
              name: tenant?.name ?? 'Tenant unavailable',
              roomName: room?.room_name ?? 'Room unavailable',
              moveInDate: row.move_in_date,
              moveOutDate: null,
              boardingHouseId: room?.boarding_house_id,
            };
          });
        }

        if (!isCurrent) return;
        setTenants(rows);
        setPageCount(Math.max(1, Math.ceil(count / PAGE_SIZE)));
      } catch (error: unknown) {
        if (!isCurrent) return;
        setTenants([]);
        setPageCount(1);
        setLoadError(errorMessage(error));
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    void loadTenants();
    return () => {
      isCurrent = false;
    };
  }, [loadAttempt, page, search, session?.user.id, status]);

  const selectStatus = (nextStatus: TenantStatus) => {
    if (nextStatus === status) return;
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
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search tenant name or room..."
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
          <Text style={styles.stateText}>No tenants match this view.</Text>
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
              <Text style={styles.roomName}>{tenant.roomName}</Text>
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