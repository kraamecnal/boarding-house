export const TENANT_DOCUMENT_BUCKET = 'tenant-documents';
export const LEGACY_TENANT_DOCUMENT_BUCKET = 'Tenant_documents';
export const TENANT_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const TENANT_DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type TenantDocumentKind = 'id' | 'agreement';
export type TenantDocumentProgressState =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'done'
  | 'failed';
export type TenantDocumentMimeType = (typeof TENANT_DOCUMENT_MIME_TYPES)[number];
export type TenantDocumentImage = {
  uri: string;
  mimeType: TenantDocumentMimeType;
  fileSize?: number;
  file?: Blob;
};
