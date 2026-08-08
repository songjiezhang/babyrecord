export const DEFAULT_SYNC_ENDPOINT = process.env.EXPO_PUBLIC_DEFAULT_SYNC_ENDPOINT?.trim() ?? '';

export function syncRequestHeaders(accessPin: string) {
  return {
    'Content-Type': 'application/json',
    'X-Sync-Key': accessPin,
  };
}

export function normalizeSyncEndpoint(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_SYNC_ENDPOINT;
  return trimmed.replace(/\/+$/, '');
}

function apiUrl(endpoint: string, path: string) {
  if (!endpoint || endpoint.startsWith('/')) return `/api/${path}`;
  const base = endpoint
    .replace(/\/(?:api\/)?sync\/?$/i, '')
    .replace(/\/api\/?$/i, '')
    .replace(/\/+$/, '');
  return `${base}/api/${path}`;
}

async function verifyPinAtPath(pin: string, endpoint: string, path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(apiUrl(endpoint, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('认证服务连接超时，请检查同步接口地址');
    }
    throw new Error('无法连接认证服务，请检查同步接口和 HTTPS 证书');
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 429) throw new Error('尝试次数过多，请稍后再试');
  if (response.status === 401) return false;
  if (!response.ok) throw new Error(`认证服务暂时不可用（HTTP ${response.status}）`);
  const result = await response.json().catch(() => null) as { ok?: boolean } | null;
  if (!result) throw new Error('认证服务返回了无法识别的数据');
  return result.ok === true;
}

export async function verifyAccessPinWithServer(pin: string, endpoint: string) {
  try {
    return await verifyPinAtPath(pin, endpoint, 'auth/access-pin');
  } catch (error) {
    if (error instanceof Error && error.message.includes('HTTP 404')) {
      return verifyPinAtPath(pin, endpoint, 'auth/admin-pin');
    }
    throw error;
  }
}
