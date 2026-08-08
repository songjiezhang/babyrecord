import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserPreferencesV1 } from '../data/schema';
import { migrateQuickShortcutIds } from '../data/records';

// v2 intentionally starts a new role session because the permission model changed.
const CURRENT_ROLE_KEY = '@babyrecord/current-role/v2';
const ROLES_KEY = '@babyrecord/roles/v2';
const LEGACY_CUSTOM_ROLES_KEY = '@babyrecord/custom-roles/v1';
const USER_PREFERENCES_PREFIX = '@babyrecord/user-preferences/v1/';

export type SavedRole = {
  id: string;
  name: string;
  isAdmin: boolean;
  createdAt: string;
};

export const DEFAULT_ROLES: SavedRole[] = [
  { id: 'family:dad', name: '爸爸', isAdmin: true, createdAt: 'system' },
  { id: 'family:mom', name: '妈妈', isAdmin: true, createdAt: 'system' },
];

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export async function loadRoleState() {
  const [currentRole, storedRoles, legacyRoles] = await Promise.all([
    readJson<SavedRole | null>(CURRENT_ROLE_KEY, null),
    readJson<SavedRole[] | null>(ROLES_KEY, null),
    readJson<SavedRole[]>(LEGACY_CUSTOM_ROLES_KEY, []),
  ]);
  const migratedRoles = [
    ...DEFAULT_ROLES,
    ...legacyRoles.filter((legacy) => !DEFAULT_ROLES.some((role) => role.id === legacy.id)),
  ];
  const roles = storedRoles?.length ? storedRoles : migratedRoles;
  if (!storedRoles?.length) await AsyncStorage.setItem(ROLES_KEY, JSON.stringify(roles));
  return { currentRole, roles };
}

export async function saveCurrentRole(role: SavedRole) {
  await AsyncStorage.setItem(CURRENT_ROLE_KEY, JSON.stringify(role));
}

export async function clearCurrentRole() {
  await AsyncStorage.removeItem(CURRENT_ROLE_KEY);
}

export async function saveRoles(roles: SavedRole[]) {
  await AsyncStorage.setItem(ROLES_KEY, JSON.stringify(roles));
}

export async function loadUserPreferences(userId: string) {
  const preferences = await readJson<UserPreferencesV1 | null>(`${USER_PREFERENCES_PREFIX}${userId}`, null);
  if (!preferences) return null;
  return { ...preferences, quickShortcutIds: migrateQuickShortcutIds(preferences.quickShortcutIds) };
}

export async function saveUserPreferences(preferences: UserPreferencesV1) {
  await AsyncStorage.setItem(`${USER_PREFERENCES_PREFIX}${preferences.userId}`, JSON.stringify({
    ...preferences,
    quickShortcutIds: migrateQuickShortcutIds(preferences.quickShortcutIds),
  }));
}
