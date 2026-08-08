import { Platform } from 'react-native';
import { APP_VERSION } from '../config/update';
import { CURRENT_DATA_SCHEMA_VERSION, type VersionedDataEnvelope } from './schema';
import type { BackupPayload } from '../storage/backups';

type ExportResult = {
  status: 'saved' | 'cancelled';
  fileName: string;
  usedFallback?: boolean;
};

type WritableFile = {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
};

type SaveFileHandle = {
  createWritable: () => Promise<WritableFile>;
};

type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<SaveFileHandle>;

function exportFileName(date = new Date()) {
  const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const timePart = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
  return `babyrecord-${datePart}-${timePart}.json`;
}

function serializeExport(payload: BackupPayload) {
  const envelope: VersionedDataEnvelope<BackupPayload> = {
    schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    payload,
  };
  return JSON.stringify(envelope, null, 2);
}

async function exportOnWeb(contents: string, fileName: string): Promise<ExportResult> {
  const saveFilePicker = (globalThis as typeof globalThis & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (saveFilePicker) {
    try {
      const handle = await saveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'BabyRecord JSON 数据', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      return { status: 'saved', fileName };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return { status: 'cancelled', fileName };
      throw error;
    }
  }

  const blobUrl = URL.createObjectURL(new Blob([contents], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  return { status: 'saved', fileName, usedFallback: true };
}

async function exportOnAndroid(contents: string, fileName: string): Promise<ExportResult> {
  const { StorageAccessFramework } = await import('expo-file-system/legacy');
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return { status: 'cancelled', fileName };
  const nameWithoutExtension = fileName.replace(/\.json$/i, '');
  const fileUri = await StorageAccessFramework.createFileAsync(permission.directoryUri, nameWithoutExtension, 'application/json');
  await StorageAccessFramework.writeAsStringAsync(fileUri, contents);
  return { status: 'saved', fileName };
}

export async function exportAppData(payload: BackupPayload): Promise<ExportResult> {
  const fileName = exportFileName();
  const contents = serializeExport(payload);
  if (Platform.OS === 'web') return exportOnWeb(contents, fileName);
  if (Platform.OS === 'android') return exportOnAndroid(contents, fileName);
  throw new Error('当前平台暂不支持选择导出目录');
}
