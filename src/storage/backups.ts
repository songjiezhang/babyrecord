import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURRENT_DATA_SCHEMA_VERSION } from '../data/schema';
import type { SavedRole } from './roles';

const BACKUPS_KEY = '@babyrecord/daily-backups/v1';
const MAX_BACKUP_DAYS = 30;

export type BackupPayload = {
  items: unknown[];
  todos: unknown[];
  babyProfile: { name: string; birthDate: string };
  customProjects: unknown[];
  syncEndpoint: string;
  roles: SavedRole[];
};

export type DailyBackup = {
  id: string;
  localDate: string;
  createdAt: string;
  schemaVersion: number;
  payload: BackupPayload;
};

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function retentionStartKey(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - (MAX_BACKUP_DAYS - 1));
  return localDateKey(start);
}

export async function loadBackups(): Promise<DailyBackup[]> {
  try {
    const value = await AsyncStorage.getItem(BACKUPS_KEY);
    return value ? JSON.parse(value) as DailyBackup[] : [];
  } catch {
    return [];
  }
}

export async function createDailyBackup(payload: BackupPayload, replaceToday = true) {
  const backups = await loadBackups();
  const localDate = localDateKey();
  if (!replaceToday && backups.some((backup) => backup.localDate === localDate)) return backups;
  const backup: DailyBackup = {
    id: `backup:${Date.now()}`,
    localDate,
    createdAt: new Date().toISOString(),
    schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    payload,
  };
  const retentionStart = retentionStartKey();
  const next = [backup, ...backups.filter((item) => item.localDate !== localDate)]
    .filter((item) => item.localDate >= retentionStart)
    .sort((a, b) => b.localDate.localeCompare(a.localDate))
    .slice(0, MAX_BACKUP_DAYS);
  await AsyncStorage.setItem(BACKUPS_KEY, JSON.stringify(next));
  return next;
}

export async function ensureTodayBackup(payload: BackupPayload) {
  return createDailyBackup(payload, false);
}
