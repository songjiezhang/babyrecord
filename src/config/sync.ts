export const DEFAULT_SYNC_ENDPOINT = process.env.EXPO_PUBLIC_DEFAULT_SYNC_ENDPOINT?.trim() ?? '';
// Deliberately never supplied by a public build variable; users save it locally on Android.
export const DEFAULT_SYNC_PASSWORD = '';

export function normalizeSyncEndpoint(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_SYNC_ENDPOINT;
  return trimmed.replace(/\/+$/, '');
}

function apiUrl(endpoint: string, path: string) {
  if (!endpoint || endpoint.startsWith('/')) return `/api/${path}`;
  const base = endpoint.replace(/\/sync\/?$/i, '').replace(/\/+$/, '');
  return `${base}/api/${path}`;
}

export async function verifyAdminPinWithServer(pin: string, endpoint: string) {
  const response = await fetch(apiUrl(endpoint, 'auth/admin-pin'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (response.status === 429) throw new Error('尝试次数过多，请稍后再试');
  if (!response.ok && response.status !== 401) throw new Error('认证服务暂时不可用');
  const result = await response.json() as { ok?: boolean };
  return result.ok === true;
}
