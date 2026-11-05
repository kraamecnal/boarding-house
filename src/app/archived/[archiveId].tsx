import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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

import { signedDocumentUrl } from '@/contexts/RoomsContext';
import { formatPeso, formatShortDate, periodLabel } from '@/utils/billing';
import { getSupabaseClient } from '@/utils/supabase';

type ArchiveTab = 'info' | 'history';

type ArchiveRow = {
  archive_id: string;
  tenancy_id: string | null;
  tenant_name: string;
  contact_number: string | null;
  email_address: string | null;
  move_in_date: string;
  move_out_date: string;
  room_name: string | null;
  boarding_house_name: string | null;
  boarding_house_address: string | null;
  id_photo_path: string | null;
  agreement_photo_path: string | null;
  archived_at: string;
};

type DbBillItem = {
  bill_item_id: string;
  item_type: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  amount: number | null;
};

type DbBill = {
  bill_id: string;
  period_start: string;
  due_date: string;
  total_amount: number;
  paid_at: string | null;
  is_paid: boolean | null;
  bill_items: DbBillItem[] | null;
};

type ArchivedBill = {
  id: string;
  period: string;
  dueDate: string;
  paidDate: string | null;
  isPaid: boolean;
  total: number;
  items: { id: string; label: string; amount: number }[];
};

function itemLabel(item: DbBillItem): string {
  switch (item.item_type) {
    case 'rent':
      return 'Room rent';
    case 'water':
      return 'Water';
    case 'trash':
      return 'Trash';
    case 'wifi':
      return 'Wifi';
    case 'electricity':
      return 'Electricity';
    default:
      return item.description || 'Adjustment';
  }
}

function mapBill(row: DbBill): ArchivedBill {
  return {
    id: row.bill_id,
    period: row.period_start.slice(0, 7),
    dueDate: row.due_date,
    paidDate: row.paid_at?.slice(0, 10) ?? null,
    isPaid: row.is_paid === true || row.paid_at !== null,
    total: Number(row.total_amount),
    items: (row.bill_items ?? []).map((item) => ({
      id: item.bill_item_id,
      label: itemLabel(item),
      amount: Number(item.amount ?? Number(item.quantity) * Number(item.unit_price)),
    })),
  };
}

export default function ArchivedTenantScreen() {
  const params = useLocalSearchParams<{ archiveId: string }>();
  const archiveId = Array.isArray(params.archiveId) ? params.archiveId[0] : params.archiveId;
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<ArchiveTab>('info');
  const [archive, setArchive] = useState<ArchiveRow | null>(null);
  const [bills, setBills] = useState<ArchivedBill[]>([]);
  const [idUri, setIdUri] = useState('');
  const [agreementUri, setAgreementUri] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        if (!archiveId) throw new Error('This archived tenant could not be found.');
        const client = getSupabaseClient();
        const { data, error } = await client
          .from('tenant_archive')
          .select(
            'archive_id, tenancy_id, tenant_name, contact_number, email_address, move_in_date, move_out_date, room_name, boarding_house_name, boarding_house_address, id_photo_path, agreement_photo_path, archived_at',
          )
          .eq('archive_id', archiveId)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('This archived tenant could not be found.');
        const row = data as ArchiveRow;

        let billRows: DbBill[] = [];
        if (row.tenancy_id) {
          const { data: billData, error: billError } = await client
            .from('monthly_bill')
            .select(
              'bill_id, period_start, due_date, total_amount, paid_at, is_paid, bill_items(bill_item_id,item_type,description,quantity,unit_price,amount)',
            )
            .eq('tenancy_id', row.tenancy_id)
            .order('period_start', { ascending: false });
          if (billError) throw billError;
          billRows = (billData ?? []) as DbBill[];
        }

        const [nextIdUri, nextAgreementUri] = await Promise.all([
          signedDocumentUrl(row.id_photo_path).catch(() => ''),
          signedDocumentUrl(row.agreement_photo_path).catch(() => ''),
        ]);

        if (!isCurrent) return;
        setArchive(row);
        setBills(billRows.map(mapBill));
        setIdUri(nextIdUri);
        setAgreementUri(nextAgreementUri);
      } catch (error: unknown) {
        if (isCurrent) {
          setLoadError(
            error instanceof Error ? error.message : 'Could not load this archived tenant.',
          );
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    void load();
    return () => {
      isCurrent = false;
    };
  }, [archiveId, loadAttempt]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Archived tenant' }} />
        <ActivityIndicator color="#2563EB" size="large" />
      </View>
    );
  }

  if (loadError || !archive) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Archived tenant' }} />
        <Text style={styles.emptyText}>{loadError ?? 'This archived tenant could not be found.'}</Text>
        <Pressable onPress={() => setLoadAttempt((attempt) => attempt + 1)} style={styles.retryButton}>
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: archive.tenant_name }} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <Ionicons name="archive-outline" size={18} color="#475467" />
          <Text style={styles.bannerText}>
            Archived · read-only · moved out {formatShortDate(archive.move_out_date)}
          </Text>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          <SectionTab
            label="Tenant's Information"
            selected={tab === 'info'}
            onPress={() => setTab('info')}
          />
          <SectionTab label="History" selected={tab === 'history'} onPress={() => setTab('history')} />
        </View>

        {tab === 'info' ? (
          <>
            <View style={styles.card}>
              <InfoRow label="Room" value={archive.room_name ?? '—'} />
              <InfoRow label="Boarding house" value={archive.boarding_house_name ?? '—'} />
              <InfoRow label="Tenant" value={archive.tenant_name} />
              <InfoRow label="Email" value={archive.email_address || '—'} />
              <InfoRow label="Contact" value={archive.contact_number || '—'} />
              <InfoRow label="Moved in" value={formatShortDate(archive.move_in_date)} />
              <InfoRow label="Moved out" value={formatShortDate(archive.move_out_date)} />
              <InfoRow label="Archived on" value={formatShortDate(archive.archived_at.slice(0, 10))} />
            </View>
            <PhotoCard label="Valid ID" uri={idUri} onPress={setViewerUri} />
            <PhotoCard label="Contract" uri={agreementUri} onPress={setViewerUri} />
          </>
        ) : bills.length === 0 ? (
          <Text style={styles.emptyText}>No bills were recorded for this tenant.</Text>
        ) : (
          bills.map((bill) => {
            const expanded = expandedBillId === bill.id;
            return (
              <View key={bill.id} style={styles.historyCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${periodLabel(bill.period)} bill, ${bill.isPaid ? 'paid' : 'unpaid'}`}
                  onPress={() => setExpandedBillId(expanded ? null : bill.id)}
                  style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}>
                  <View style={styles.historyCopy}>
                    <Text style={styles.historyTitle}>{periodLabel(bill.period)} bill</Text>
                    <Text style={bill.isPaid ? styles.paidText : styles.unpaidText}>
                      {bill.isPaid && bill.paidDate
                        ? `Paid on ${formatShortDate(bill.paidDate)}`
                        : bill.isPaid
                          ? 'Paid'
                          : `Unpaid · due ${formatShortDate(bill.dueDate)}`}
                    </Text>
                  </View>
                  <Text style={styles.historyAmount}>{formatPeso(bill.total)}</Text>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color="#8A94A6"
                  />
                </Pressable>

                {expanded && (
                  <View style={styles.breakdown}>
                    {bill.items.length === 0 ? (
                      <Text style={styles.breakdownEmpty}>No itemized charges were recorded.</Text>
                    ) : (
                      bill.items.map((item) => (
                        <View key={item.id} style={styles.breakdownRow}>
                          <Text style={styles.breakdownLabel}>{item.label}</Text>
                          <Text style={styles.breakdownAmount}>{formatPeso(item.amount)}</Text>
                        </View>
                      ))
                    )}
                    <View style={[styles.breakdownRow, styles.breakdownTotal]}>
                      <Text style={styles.breakdownTotalLabel}>Total</Text>
                      <Text style={styles.breakdownTotalAmount}>{formatPeso(bill.total)}</Text>
                    </View>
                    <Text style={styles.breakdownMeta}>
                      Due {formatShortDate(bill.dueDate)}
                      {bill.paidDate ? ` · Paid ${formatShortDate(bill.paidDate)}` : ''}
                    </Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={viewerUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}>
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
      style={[styles.tab, selected && styles.selectedTab]}>
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
      {uri ? (
        <>
          <Pressable
            onPress={() => onPress(uri)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`View ${label} photo`}>
            <Image source={{ uri }} style={styles.photo} />
          </Pressable>
          <Text style={styles.photoHint}>Tap to view full size</Text>
        </>
      ) : (
        <View style={[styles.photo, styles.photoUnavailable]}>
          <Text style={styles.photoHint}>Document unavailable</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
    backgroundColor: '#f8f9fa',
  },
  content: { padding: 16, paddingBottom: 48, gap: 12, flexGrow: 1 },
  emptyText: {
    marginTop: 40,
    fontSize: 16,
    fontWeight: '500',
    color: '#7A8494',
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
  },
  retryLabel: { color: '#2563EB', fontSize: 14, fontWeight: '600' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F2F4F7',
  },
  bannerText: { flex: 1, color: '#475467', fontSize: 13, fontWeight: '600' },
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
  selectedTab: { backgroundColor: '#FFFFFF' },
  tabLabel: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  selectedTabLabel: { color: '#1A2B3C' },
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
  infoRow: { flexDirection: 'row', gap: 12 },
  infoLabel: { width: 110, color: '#6B7280', fontSize: 14 },
  infoValue: { flex: 1, color: '#1A2B3C', fontSize: 14, fontWeight: '600' },
  photoLabel: { color: '#1A2B3C', fontSize: 14, fontWeight: '700' },
  photo: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    backgroundColor: '#F7F8FA',
    resizeMode: 'cover',
  },
  photoUnavailable: { alignItems: 'center', justifyContent: 'center' },
  photoHint: { color: '#6B7280', fontSize: 12 },
  historyCard: {
    borderRadius: 12,
    backgroundColor: 'white',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  pressed: { opacity: 0.85 },
  historyCopy: { flex: 1, gap: 2 },
  historyTitle: { color: '#1A2B3C', fontSize: 16, fontWeight: '700' },
  paidText: { color: '#067647', fontSize: 13, fontWeight: '600' },
  unpaidText: { color: '#B42318', fontSize: 13, fontWeight: '600' },
  historyAmount: { color: '#1A2B3C', fontSize: 15, fontWeight: '700' },
  breakdown: {
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E4E7EC',
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  breakdownLabel: { flex: 1, color: '#475467', fontSize: 14 },
  breakdownAmount: { color: '#1A2B3C', fontSize: 14, fontWeight: '600' },
  breakdownTotal: { paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E4E7EC' },
  breakdownTotalLabel: { color: '#1A2B3C', fontSize: 15, fontWeight: '700' },
  breakdownTotalAmount: { color: '#1A2B3C', fontSize: 15, fontWeight: '700' },
  breakdownEmpty: { color: '#6B7280', fontSize: 13 },
  breakdownMeta: { color: '#6B7280', fontSize: 12 },
  viewer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  viewerImage: { width: '100%', height: '100%', resizeMode: 'contain' },
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