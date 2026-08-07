import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURRENT_DATA_SCHEMA_VERSION, migrateEnvelope, type VersionedDataEnvelope } from '../data/schema';

const APP_DATA_KEY = '@babyrecord/shared-data/v2';

export type SharedAppData = {
  items: unknown[];
  todos: unknown[];
  babyProfile: { name: string; birthDate: string };
  customProjects: unknown[];
};

export async function loadSharedAppData(): Promise<SharedAppData | null> {
  try {
    const stored = await AsyncStorage.getItem(APP_DATA_KEY);
    if (!stored) return null;
    const envelope = migrateEnvelope(JSON.parse(stored) as VersionedDataEnvelope);
    return envelope.payload as SharedAppData;
  } catch {
    return null;
  }
}

export async function saveSharedAppData(payload: SharedAppData) {
  const envelope: VersionedDataEnvelope<SharedAppData> = {
    schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: '1.0.1',
    payload,
  };
  await AsyncStorage.setItem(APP_DATA_KEY, JSON.stringify(envelope));
}
