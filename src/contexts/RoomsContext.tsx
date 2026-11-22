import { File as ExpoFile } from 'expo-file-system';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { CHARGES, type ChargeType } from '@/data/charges';
import {
  LEGACY_TENANT_DOCUMENT_BUCKET,
  TENANT_DOCUMENT_BUCKET,
  TENANT_DOCUMENT_MAX_BYTES,
  TENANT_DOCUMENT_MIME_TYPES,
  type TenantDocumentImage,
  type TenantDocumentKind,
  type TenantDocumentProgressState,
} from '@/data/tenantDocuments';
import { getSupabaseClient } from '@/utils/supabase';

export type RoomStatus = 'vacant' | 'occupied';

export type Tenant = {
  id: string;
  tenancyId: string;
  firstName: string;
  lastName: string;
  email: string;
  contactNumber: string;
  startDate: string;
  idImageUri: string;
  contractImageUri: string;
  idImagePath: string;
  contractImagePath: string;
};

export type Room = {
  id: string;
  boardingHouseId: string;
  roomName: string;
  monthlyRate: number;
  status: RoomStatus;
  tenant: Tenant | null;
  createdAt: string;
};

export type OccupiedRoom = Room & { status: 'occupied'; tenant: Tenant };

type NewRoomInput = Pick<
  Room,
  'boardingHouseId' | 'roomName' | 'monthlyRate'
> & {
  requestId: string;
  initialMeterReading: { value: number; readingAt: string } | null;
};
export type NewTenantInput = {
  firstName: string;
  lastName: string;
  email: string;
  contactNumber: string;
  startDate: string;
  openingMeterReading: number | null;
  idImage: TenantDocumentImage;
  contractImage: TenantDocumentImage;
};
export type TenantChargeOverrides = Partial<Record<ChargeType, string>>;
type EditRoomInput = Pick<Room, 'roomName' | 'monthlyRate'>;

type RoomRow = {
  room_id: string;
  boarding_house_id: string;
  room_name: string;
  monthly_rate: number;
  is_occupied: boolean;
  last_updated_at: string;
};

type TenancyRow = {
  tenancy_id: string;
  tenant_id: string;
  room_id: string;
  move_in_date: string;
  status: string;
  agreement_photo_url: string | null;
  tenants:
    | {
        tenant_id: string;
        name: string;
        contact_number: string | null;
        email_address: string | null;
        id_photo_url: string | null;
      }
    | {
        tenant_id: string;
        name: string;
        contact_number: string | null;
        email_address: string | null;
        id_photo_url: string | null;
      }[]
    | null;
};

type ContextValue = {
  rooms: Room[];
  isLoading: boolean;
  loadError: string | null;
  reload: () => void;
  getRoomsForHouse: (boardingHouseId: string) => Room[];
  getRoomById: (id: string) => Room | undefined;
  isRoomNameTaken: (boardingHouseId: string, roomName: string) => boolean;
  addRoom: (input: NewRoomInput) => Promise<void>;
  updateRoom: (id: string, input: EditRoomInput) => Promise<Room>;
  assignTenant: (
    roomId: string,
    input: NewTenantInput,
    customCharges?: TenantChargeOverrides,
    onDocumentProgress?: (
      kind: TenantDocumentKind,
      state: TenantDocumentProgressState,
    ) => void,
  ) => Promise<string | null>;
  refreshTenantDocument: (roomId: string, kind: TenantDocumentKind) => Promise<string>;
  replaceTenantDocument: (
    roomId: string,
    kind: TenantDocumentKind,
    image: TenantDocumentImage,
  ) => Promise<string | null>;
  removeRoom: (id: string) => Promise<void>;
  /** Moves the current tenant (and their bill history) to Archived and frees the room. */
  archiveTenant: (roomId: string) => Promise<void>;
};

export function isOccupied(room: Room): room is OccupiedRoom {
  return room.status === 'occupied' && room.tenant !== null;
}

export class DuplicateRoomNameError extends Error {
  constructor() {
    super('This boarding house already has a room with this name.');
    this.name = 'DuplicateRoomNameError';
  }
}

// add one month then minus 1 day
export function addOneMonth(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);

  // Move to the next month
  const targetMonthIndex = month;

  // Get the last valid day of the target month
  const daysInTargetMonth = new Date(year, targetMonthIndex + 1, 0).getDate();

  // Prevent invalid dates (e.g. January 31 → February 28)
  const clampedDay = Math.min(day, daysInTargetMonth);

  // Construct the date one month later
  const result = new Date(year, targetMonthIndex, clampedDay);

  // Subtract one day
  result.setDate(result.getDate() - 1);

  // Format as YYYY-MM-DD
  const yyyy = result.getFullYear();
  const mm = String(result.getMonth() + 1).padStart(2, '0');
  const dd = String(result.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}


const RoomsContext = createContext<ContextValue | undefined>(undefined);

function relatedTenant(value: TenancyRow['tenants']) {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function splitName(name: string) {
  const [firstName = '', ...lastName] = name.trim().split(/\s+/);
  return { firstName, lastName: lastName.join(' ') };
}

function isMissingStorageObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('statusCode' in error) || error.statusCode !== '404') return false;

  return (
    ('code' in error && (error.code === 'not_found' || error.code === 'NoSuchKey')) ||
    ('message' in error && error.message === 'Object not found')
  );
}

export async function signedDocumentUrl(path: string | null): Promise<string> {
  if (!path) return '';
  const startedAt = Date.now();
  if (/^https?:\/\//i.test(path)) return path;
  const pathParts = path.split('/');
  const isCurrentDocumentPath =
    pathParts.length === 5 && ['id', 'agreement'].includes(pathParts[3]);
  const bucket = isCurrentDocumentPath
    ? TENANT_DOCUMENT_BUCKET
    : LEGACY_TENANT_DOCUMENT_BUCKET;
  const { data, error } = await getSupabaseClient()
    .storage.from(bucket)
    .createSignedUrl(path, 60 * 15);
  if (error) {
    if (isMissingStorageObject(error)) return '';
    throw error;
  }
  if (__DEV__) {
    console.info(`[TenantDocuments] Signed URL creation: ${Date.now() - startedAt}ms`);
  }
  return data.signedUrl;
}

function uniqueStorageToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}-${Math.random()
    .toString(36)
    .slice(2, 14)}`;
}

function documentBucketForPath(path: string): string {
  const pathParts = path.split('/');
  return pathParts.length === 5 && ['id', 'agreement'].includes(pathParts[3])
    ? TENANT_DOCUMENT_BUCKET
    : LEGACY_TENANT_DOCUMENT_BUCKET;
}

async function uploadDocument(
  ownerId: string,
  roomId: string,
  registrationId: string,
  kind: TenantDocumentKind,
  image: TenantDocumentImage,
  onPathCreated?: (path: string) => void,
): Promise<string> {
  if (!TENANT_DOCUMENT_MIME_TYPES.includes(image.mimeType)) {
    throw new Error('Choose a JPEG, PNG, or WebP image for each tenant document.');
  }
  const file = image.file ?? new ExpoFile(image.uri);
  const fileSize = image.fileSize ?? file.size;
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error('Could not determine the selected document size. Select it again.');
  }
  if (fileSize > TENANT_DOCUMENT_MAX_BYTES) {
    throw new Error('Tenant documents must be smaller than 5 MB.');
  }
  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }[image.mimeType];
  const path = `${ownerId}/${roomId}/${registrationId}/${kind}/${uniqueStorageToken()}.${extension}`;
  onPathCreated?.(path);
  const { error } = await getSupabaseClient()
    .storage.from(TENANT_DOCUMENT_BUCKET)
    .upload(path, file, { contentType: image.mimeType, upsert: false });
  if (error) {
    const label = kind === 'id' ? 'valid ID' : 'signed agreement';
    throw new Error(`Could not upload the ${label} photo: ${error.message}`);
  }
  return path;
}

async function removeIfUnreferenced(ownerId: string, path: string): Promise<void> {
  const client = getSupabaseClient();
  const [
    { data: tenant, error: tenantError },
    { data: tenancy, error: tenancyError },
    { data: archivedId, error: archivedIdError },
    { data: archivedAgreement, error: archivedAgreementError },
  ] = await Promise.all([
      client
        .from('tenants')
        .select('tenant_id')
        .eq('owner_id', ownerId)
        .eq('id_photo_url', path)
        .maybeSingle(),
      client
        .from('tenancy')
        .select('tenancy_id')
        .eq('owner_id', ownerId)
        .eq('agreement_photo_url', path)
        .maybeSingle(),
      client
        .from('tenant_archive')
        .select('archive_id')
        .eq('owner_id', ownerId)
        .eq('id_photo_path', path)
        .maybeSingle(),
      client
        .from('tenant_archive')
        .select('archive_id')
        .eq('owner_id', ownerId)
        .eq('agreement_photo_path', path)
        .maybeSingle(),
    ]);
  if (tenantError) throw tenantError;
  if (tenancyError) throw tenancyError;
  if (archivedIdError) throw archivedIdError;
  if (archivedAgreementError) throw archivedAgreementError;
  if (tenant || tenancy || archivedId || archivedAgreement) return;

  const { error } = await client.storage.from(documentBucketForPath(path)).remove([path]);
  if (error) throw error;
}

async function cleanupUploadedDocuments(ownerId: string, paths: string[]): Promise<void> {
  await Promise.all(paths.map(async (path) => {
    try {
      await removeIfUnreferenced(ownerId, path);
    } catch (cleanupError: unknown) {
      console.error('Could not safely remove an unreferenced tenant document.', cleanupError);
    }
  }));
}

export function RoomsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const ownerId = session?.user.id;
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;

    const loadRooms = async () => {
      setIsLoading(true);
      setLoadError(null);
      if (!ownerId) {
        setRooms([]);
        setIsLoading(false);
        return;
      }

      try {
        const client = getSupabaseClient();
        const [{ data: roomRows, error: roomError }, { data: tenancyRows, error: tenancyError }] =
          await Promise.all([
            client
              .from('rooms')
              .select('room_id, boarding_house_id, room_name, monthly_rate, is_occupied, last_updated_at')
              .order('last_updated_at', { ascending: false }),
            client
              .from('tenancy')
              .select(
                'tenancy_id, tenant_id, room_id, move_in_date, status, agreement_photo_url, tenants(tenant_id,name,contact_number,email_address,id_photo_url)',
              )
              .eq('owner_id', ownerId)
              .in('status', ['active', 'scheduled'])
              .order('move_in_date', { ascending: false }),
          ]);
        if (roomError) throw roomError;
        if (tenancyError) throw tenancyError;

        const currentTenancies = new Map<string, TenancyRow>();
        for (const tenancy of (tenancyRows ?? []) as TenancyRow[]) {
          if (!currentTenancies.has(tenancy.room_id)) currentTenancies.set(tenancy.room_id, tenancy);
        }

        const nextRooms = await Promise.all(
          ((roomRows ?? []) as RoomRow[]).map(async (row) => {
            const tenancy = currentTenancies.get(row.room_id);
            const tenantRow = tenancy ? relatedTenant(tenancy.tenants) : undefined;
            let tenant: Tenant | null = null;
            if (tenancy && tenantRow) {
              const { firstName, lastName } = splitName(tenantRow.name);
              tenant = {
                id: tenantRow.tenant_id,
                tenancyId: tenancy.tenancy_id,
                firstName,
                lastName,
                email: tenantRow.email_address ?? '',
                contactNumber: tenantRow.contact_number ?? '',
                startDate: tenancy.move_in_date,
                idImageUri: '',
                contractImageUri: '',
                idImagePath: tenantRow.id_photo_url ?? '',
                contractImagePath: tenancy.agreement_photo_url ?? '',
              };
            }

            return {
              id: row.room_id,
              boardingHouseId: row.boarding_house_id,
              roomName: row.room_name,
              monthlyRate: Number(row.monthly_rate),
              status: row.is_occupied || tenant ? 'occupied' as const : 'vacant' as const,
              tenant,
              createdAt: row.last_updated_at,
            };
          }),
        );
        if (isCurrent) setRooms(nextRooms);
      } catch (error: unknown) {
        if (isCurrent) {
          setRooms([]);
          setLoadError(error instanceof Error ? error.message : 'Could not load rooms.');
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    };

    void loadRooms();
    return () => {
      isCurrent = false;
    };
  }, [loadAttempt, ownerId]);

  const value = useMemo<ContextValue>(
    () => ({
      rooms,
      isLoading,
      loadError,
      reload: () => setLoadAttempt((attempt) => attempt + 1),
      getRoomsForHouse: (boardingHouseId) =>
        rooms.filter((room) => room.boardingHouseId === boardingHouseId),
      getRoomById: (id) => rooms.find((room) => room.id === id),
      isRoomNameTaken: (boardingHouseId, roomName) =>
        rooms.some(
          (room) =>
            room.boardingHouseId === boardingHouseId &&
            room.roomName.trim().toLowerCase() === roomName.trim().toLowerCase(),
        ),
      addRoom: async (input) => {
        const client = getSupabaseClient();
        const parameters = {
          p_boarding_house_id: input.boardingHouseId,
          p_room_name: input.roomName.trim(),
          p_monthly_rate: input.monthlyRate,
          p_request_id: input.requestId,
          p_initial_reading_value: input.initialMeterReading?.value ?? null,
          p_initial_reading_at: input.initialMeterReading?.readingAt ?? null,
        };
        let result = await client.rpc('create_room_with_meter_reading', parameters);
        if (result.error?.code === 'PGRST202') {
          result = await client.rpc('create_room_with_meter_reading', {
            ...parameters,
            p_meter_reading_day: 15,
          });
        }
        const { data: roomId, error } = result;
        if (error) throw error;
        if (typeof roomId !== 'string') {
          throw new Error('The room was saved without returning its identifier.');
        }
        setRooms((current) =>
          current.some((room) => room.id === roomId)
            ? current
            : [
                {
                  id: roomId,
                  boardingHouseId: input.boardingHouseId,
                  roomName: input.roomName.trim(),
                  monthlyRate: input.monthlyRate,
                  status: 'vacant',
                  tenant: null,
                  createdAt: new Date().toISOString(),
                },
                ...current,
              ],
        );
      },
      updateRoom: async (id, input) => {
        if (!ownerId) throw new Error('Your signed-in owner account could not be identified.');
        const currentRoom = rooms.find((room) => room.id === id);
        if (!currentRoom) throw new Error('This room is no longer available.');

        const roomName = input.roomName.trim();
        if (!roomName) throw new Error('Enter a room name.');
        const nameChanged = roomName !== currentRoom.roomName;
        const rentChanged = input.monthlyRate !== currentRoom.monthlyRate;
        if (!nameChanged && !rentChanged) return currentRoom;

        const client = getSupabaseClient();
        if (nameChanged) {
          const { data: otherRooms, error: duplicateCheckError } = await client
            .from('rooms')
            .select('room_id, room_name')
            .eq('boarding_house_id', currentRoom.boardingHouseId)
            .neq('room_id', id);
          if (duplicateCheckError) throw duplicateCheckError;
          const normalizedName = roomName.toLowerCase();
          if (
            (otherRooms ?? []).some(
              (room) => room.room_name?.trim().toLowerCase() === normalizedName,
            )
          ) {
            throw new DuplicateRoomNameError();
          }
        }

        let updatedRoom: Room;
        if (rentChanged) {
          const parameters: {
            p_room_id: string;
            p_room_name?: string;
            p_monthly_rate: number;
          } = {
            p_room_id: id,
            p_monthly_rate: input.monthlyRate,
          };
          if (nameChanged) parameters.p_room_name = roomName;

          const { data, error } = await client.rpc(
            'edit_room_with_rent_sync',
            parameters,
          );
          if (error) {
            if (error.code === '23505') throw new DuplicateRoomNameError();
            throw error;
          }
          if (
            !data ||
            typeof data !== 'object' ||
            !('room_id' in data) ||
            data.room_id !== id ||
            !('tenancy_count' in data) ||
            !('tenancy_updated_count' in data) ||
            data.tenancy_count !== data.tenancy_updated_count
          ) {
            throw new Error(
              'The room and current tenancy rent could not be fully updated. Please try again.',
            );
          }
          updatedRoom = {
            ...currentRoom,
            roomName: 'room_name' in data ? String(data.room_name) : roomName,
            monthlyRate:
              'monthly_rate' in data ? Number(data.monthly_rate) : input.monthlyRate,
            createdAt:
              'last_updated_at' in data
                ? String(data.last_updated_at)
                : currentRoom.createdAt,
          };
        } else {
          const { data, error } = await client
            .from('rooms')
            .update({ room_name: roomName })
            .eq('room_id', id)
            .select('room_id, room_name, monthly_rate, last_updated_at')
            .single();
          if (error) {
            if (error.code === '23505') throw new DuplicateRoomNameError();
            if (error.code === 'PGRST116') {
              throw new Error('The room could not be updated. It may not exist or be authorized.');
            }
            throw error;
          }
          if (!data) throw new Error('The room update returned no row.');
          updatedRoom = {
            ...currentRoom,
            roomName: data.room_name,
            monthlyRate: Number(data.monthly_rate),
            createdAt: data.last_updated_at,
          };
        }

        setRooms((current) =>
          current.map((room) => (room.id === id ? updatedRoom : room)),
        );
        return updatedRoom;
      },
      assignTenant: async (roomId, input, customCharges = {}, onDocumentProgress) => {
        if (!ownerId) throw new Error('Your signed-in owner account could not be identified.');
        const uploadedPaths: string[] = [];
        const registrationId = uniqueStorageToken();

        try {
          const upload = async (kind: TenantDocumentKind, image: TenantDocumentImage) => {
            const startedAt = Date.now();
            onDocumentProgress?.(kind, 'uploading');
            try {
              const path = await uploadDocument(
                ownerId,
                roomId,
                registrationId,
                kind,
                image,
                (candidatePath) => uploadedPaths.push(candidatePath),
              );
              onDocumentProgress?.(kind, 'done');
              if (__DEV__) {
                console.info(`[TenantDocuments] ${kind} upload: ${Date.now() - startedAt}ms`);
              }
              return path;
            } catch (error: unknown) {
              onDocumentProgress?.(kind, 'failed');
              if (__DEV__) {
                console.info(
                  `[TenantDocuments] ${kind} upload failed: ${Date.now() - startedAt}ms`,
                );
              }
              throw error;
            }
          };

          const [idResult, agreementResult] = await Promise.allSettled([
            upload('id', input.idImage),
            upload('agreement', input.contractImage),
          ]);
          if (idResult.status === 'rejected') throw idResult.reason;
          if (agreementResult.status === 'rejected') throw agreementResult.reason;
          const idPhotoPath = idResult.value;
          const contractPath = agreementResult.value;

          const selectedCharges = CHARGES.flatMap(({ key }) => {
            const rate = customCharges[key]?.trim();
            return rate === undefined || rate === ''
              ? []
              : [{ item_type: key, unit_price: Number(rate) }];
          });
          const rpcStartedAt = Date.now();
          const { data: tenancyId, error } = await getSupabaseClient().rpc(
            'register_tenancy_with_opening_reading',
            {
              p_room_id: roomId,
              p_name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
              p_contact_number: input.contactNumber.trim(),
              p_email_address: input.email.trim(),
              p_id_photo_url: idPhotoPath,
              p_agreement_photo_url: contractPath,
              p_move_in_date: input.startDate,
              p_custom_charges: selectedCharges,
              p_opening_reading_value: input.openingMeterReading,
            },
          );
          if (__DEV__) {
            console.info(`[TenantDocuments] Registration RPC: ${Date.now() - rpcStartedAt}ms`);
          }
          if (error) throw error;
          if (!tenancyId) throw new Error('The tenancy was saved without returning its identifier.');
          const tenant: Tenant = {
            id: tenancyId,
            tenancyId,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            email: input.email.trim(),
            contactNumber: input.contactNumber.trim(),
            startDate: input.startDate,
            idImageUri: input.idImage.uri,
            contractImageUri: input.contractImage.uri,
            idImagePath: idPhotoPath,
            contractImagePath: contractPath,
          };
          setRooms((current) =>
            current.map((room) =>
              room.id === roomId ? { ...room, status: 'occupied', tenant } : room,
            ),
          );
          return null;
        } catch (error: unknown) {
          await cleanupUploadedDocuments(ownerId, uploadedPaths);
          throw error;
        }
      },
      refreshTenantDocument: async (roomId, kind) => {
        if (!ownerId) throw new Error('Your signed-in owner account could not be identified.');
        const room = rooms.find((item) => item.id === roomId);
        if (!room || !isOccupied(room)) throw new Error('Tenant details are no longer available.');

        const client = getSupabaseClient();
        let path: string | null;
        if (kind === 'id') {
          const { data, error } = await client
            .from('tenants')
            .select('id_photo_url')
            .eq('tenant_id', room.tenant.id)
            .eq('owner_id', ownerId)
            .single();
          if (error) throw error;
          path = data.id_photo_url;
        } else {
          const { data, error } = await client
            .from('tenancy')
            .select('agreement_photo_url')
            .eq('tenancy_id', room.tenant.tenancyId)
            .eq('owner_id', ownerId)
            .single();
          if (error) throw error;
          path = data.agreement_photo_url;
        }

        const uri = await signedDocumentUrl(path);
        setRooms((current) =>
          current.map((item) => {
            if (item.id !== roomId || !isOccupied(item)) return item;
            return {
              ...item,
              tenant: {
                ...item.tenant,
                ...(kind === 'id'
                  ? { idImageUri: uri, idImagePath: path ?? '' }
                  : { contractImageUri: uri, contractImagePath: path ?? '' }),
              },
            };
          }),
        );
        return uri;
      },
      replaceTenantDocument: async (roomId, kind, image) => {
        if (!ownerId) throw new Error('Your signed-in owner account could not be identified.');
        const room = rooms.find((item) => item.id === roomId);
        if (!room || !isOccupied(room)) throw new Error('Tenant details are no longer available.');

        const uploadedPaths: string[] = [];
        let path: string;
        try {
          path = await uploadDocument(
            ownerId,
            roomId,
            uniqueStorageToken(),
            kind,
            image,
            (candidatePath) => uploadedPaths.push(candidatePath),
          );
        } catch (error: unknown) {
          await cleanupUploadedDocuments(ownerId, uploadedPaths);
          throw error;
        }

        try {
          const { error } =
            kind === 'id'
              ? await getSupabaseClient()
                  .from('tenants')
                  .update({ id_photo_url: path })
                  .eq('tenant_id', room.tenant.id)
                  .eq('owner_id', ownerId)
                  .select('tenant_id')
                  .single()
              : await getSupabaseClient()
                  .from('tenancy')
                  .update({ agreement_photo_url: path })
                  .eq('tenancy_id', room.tenant.tenancyId)
                  .eq('owner_id', ownerId)
                  .select('tenancy_id')
                  .single();
          if (error) throw error;
        } catch (error: unknown) {
          await cleanupUploadedDocuments(ownerId, [path]);
          throw error;
        }

        const oldPath = kind === 'id' ? room.tenant.idImagePath : room.tenant.contractImagePath;
        setRooms((current) =>
          current.map((item) => {
            if (item.id !== roomId || !isOccupied(item)) return item;
            return {
              ...item,
              tenant: {
                ...item.tenant,
                ...(kind === 'id'
                  ? { idImageUri: image.uri, idImagePath: path }
                  : { contractImageUri: image.uri, contractImagePath: path }),
              },
            };
          }),
        );

        if (oldPath && oldPath !== path) {
          try {
            await removeIfUnreferenced(ownerId, oldPath);
          } catch (cleanupError: unknown) {
            console.error('The replacement was saved, but the previous tenant document was not removed.', cleanupError);
            return 'The new document was saved, but the previous file could not be removed.';
          }
        }
        return null;
      },
      removeRoom: async (id) => {
        const { error } = await getSupabaseClient().from('rooms').delete().eq('room_id', id);
        if (error) throw error;
        setRooms((current) => current.filter((room) => room.id !== id));
      },
      archiveTenant: async (roomId) => {
        const room = rooms.find((item) => item.id === roomId);
        if (!room || !isOccupied(room)) throw new Error('This room has no tenant to archive.');

        const { error } = await getSupabaseClient().rpc('archive_tenancy', {
          p_tenancy_id: room.tenant.tenancyId,
        });
        if (error) throw error;

        setRooms((current) =>
          current.map((item) =>
            item.id === roomId ? { ...item, status: 'vacant', tenant: null } : item,
          ),
        );
      },
    }),
    [isLoading, loadError, ownerId, rooms],
  );

  return <RoomsContext.Provider value={value}>{children}</RoomsContext.Provider>;
}

export function useRooms() {
  const ctx = useContext(RoomsContext);
  if (!ctx) {
    throw new Error('useRooms must be used within a RoomsProvider');
  }
  return ctx;
}