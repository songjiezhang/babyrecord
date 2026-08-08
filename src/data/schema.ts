/**
 * Persistent data must always be wrapped in a versioned envelope.
 * UI models may change freely; stored data is upgraded through explicit migrations.
 */
export const CURRENT_DATA_SCHEMA_VERSION = 5;

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
  migrate: (payload: unknown, envelope: VersionedDataEnvelope) => unknown;
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

function legacyRecordDate(value: Record<string, unknown>, envelope: VersionedDataEnvelope) {
  const timestamp = Number(value.id);
  const date = Number.isFinite(timestamp) && timestamp > 1_000_000_000_000
    ? new Date(timestamp)
    : new Date(envelope.exportedAt);
  if (Number.isNaN(date.getTime())) return envelope.exportedAt.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addRecordDatesAndRemovePrototypeData(payload: unknown, envelope: VersionedDataEnvelope) {
  if (!isObject(payload)) return payload;
  const prototypeItemIds = new Set(['1', '2', '3', '4', '5', '6', '7', '8']);
  const prototypeTodoIds = new Set(['t1', 't2', 't3']);
  const prototypeProjectIds = new Set(['c1', 'c2']);
  const items = Array.isArray(payload.items)
    ? payload.items
        .filter((value) => !isObject(value) || !prototypeItemIds.has(String(value.id ?? '')))
        .map((value) => isObject(value) && typeof value.dateKey !== 'string'
          ? { ...value, dateKey: legacyRecordDate(value, envelope) }
          : value)
    : [];
  const todos = Array.isArray(payload.todos)
    ? payload.todos.filter((value) => !isObject(value) || !prototypeTodoIds.has(String(value.id ?? '')))
    : [];
  const customProjects = Array.isArray(payload.customProjects)
    ? payload.customProjects.filter((value) => !isObject(value) || !prototypeProjectIds.has(String(value.id ?? '')))
    : [];
  const babyProfile = isObject(payload.babyProfile)
    && payload.babyProfile.name === '小满'
    && payload.babyProfile.birthDate === '2025-11-27'
    ? { name: '宝宝', birthDate: '' }
    : payload.babyProfile;
  return { ...payload, items, todos, customProjects, babyProfile };
}

function addDefaultBathProject(payload: unknown) {
  if (!isObject(payload)) return payload;
  const customProjects = Array.isArray(payload.customProjects) ? payload.customProjects : [];
  const alreadyExists = customProjects.some((value) => isObject(value)
    && (value.id === 'default-bath' || value.name === '洗澡'));
  if (alreadyExists) return payload;
  return {
    ...payload,
    customProjects: [
      ...customProjects,
      {
        id: 'default-bath',
        name: '洗澡',
        icon: 'bathtub-outline',
        color: '#5C8BC7',
        soft: '#E8F1FA',
        timeMode: 'range',
      },
    ],
  };
}

function promoteBathToBuiltInRecord(payload: unknown) {
  if (!isObject(payload)) return payload;
  const items = Array.isArray(payload.items)
    ? payload.items.map((value) => isObject(value) && value.kind === 'custom' && value.title === '洗澡'
      ? { ...value, kind: 'bath', timeMode: 'range' }
      : value)
    : payload.items;
  const customProjects = Array.isArray(payload.customProjects)
    ? payload.customProjects.filter((value) => !isObject(value) || value.id !== 'default-bath')
    : [];
  return { ...payload, items, customProjects };
}

// Published migrations are append-only and must stay deterministic.
export const DATA_MIGRATIONS: DataMigration[] = [
  { from: 1, to: 2, migrate: addRecordTimeModes },
  { from: 2, to: 3, migrate: addRecordDatesAndRemovePrototypeData },
  { from: 3, to: 4, migrate: addDefaultBathProject },
  { from: 4, to: 5, migrate: promoteBathToBuiltInRecord },
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
      payload: migration.migrate(current.payload, current),
    };
  }
  return current;
}
