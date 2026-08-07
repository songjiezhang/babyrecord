/**
 * Persistent data must always be wrapped in a versioned envelope.
 * UI models may change freely; stored data is upgraded through explicit migrations.
 */
export const CURRENT_DATA_SCHEMA_VERSION = 2;

export type VersionedDataEnvelope<T = unknown> = {
  schemaVersion: number;
  exportedAt: string;
  appVersion?: string;
  payload: T;
};

/** Preferences belong to a user, not to the shared baby profile. */
export type UserPreferencesV1 = {
  userId: string;
  quickShortcutIds: string[];
  elderMode: boolean;
  syncEndpoint?: string;
  syncPassword?: string;
  updatedAt: string;
};

export type DataMigration = {
  from: number;
  to: number;
  migrate: (payload: unknown) => unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addRecordTimeModes(payload: unknown) {
  if (!isObject(payload)) return payload;
  const items = Array.isArray(payload.items)
    ? payload.items.map((value) => {
        if (!isObject(value) || value.timeMode === 'instant' || value.timeMode === 'range') return value;
        return { ...value, timeMode: value.kind === 'sleep' || value.kind === 'activity' ? 'range' : 'instant' };
      })
    : payload.items;
  const customProjects = Array.isArray(payload.customProjects)
    ? payload.customProjects.map((value) => isObject(value) && value.timeMode !== 'instant' && value.timeMode !== 'range'
      ? { ...value, timeMode: 'instant' }
      : value)
    : payload.customProjects;
  return { ...payload, items, customProjects };
}

// Published migrations are append-only and must stay deterministic.
export const DATA_MIGRATIONS: DataMigration[] = [
  { from: 1, to: 2, migrate: addRecordTimeModes },
];

export function migrateEnvelope(envelope: VersionedDataEnvelope): VersionedDataEnvelope {
  if (envelope.schemaVersion > CURRENT_DATA_SCHEMA_VERSION) {
    throw new Error('数据来自更高版本的 APP，请先升级应用');
  }

  let current = envelope;
  while (current.schemaVersion < CURRENT_DATA_SCHEMA_VERSION) {
    const migration = DATA_MIGRATIONS.find((item) => item.from === current.schemaVersion);
    if (!migration) throw new Error(`缺少数据迁移：v${current.schemaVersion}`);
    current = {
      ...current,
      schemaVersion: migration.to,
      payload: migration.migrate(current.payload),
    };
  }
  return current;
}
