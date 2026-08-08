export const APP_VERSION = '1.0.6-beta.1';
export const ANDROID_APK_NAME = `babyrecord-v${APP_VERSION}.apk`;

export type AppUpdateManifest = {
  version: string;
  prerelease: boolean;
};

const githubRepository = process.env.EXPO_PUBLIC_GITHUB_REPOSITORY?.trim() ?? '';
const githubProxyBase = process.env.EXPO_PUBLIC_GITHUB_PROXY_BASE?.trim().replace(/\/+$/, '') ?? '';

export function proxyGithubDownloadUrl(directUrl: string) {
  if (!githubProxyBase || !/^https:\/\/github\.com\//i.test(directUrl)) return directUrl;
  return `${githubProxyBase}/${directUrl.replace(/^https?:\/\//i, '')}`;
}

export function androidApkDownloadUrl(version = APP_VERSION) {
  if (!githubRepository) return '';
  const filename = `babyrecord-v${version}.apk`;
  const directUrl = `https://github.com/${githubRepository}/releases/download/v${version}/${filename}`;
  return proxyGithubDownloadUrl(directUrl);
}

function versionApiUrl(syncEndpoint: string) {
  if (!syncEndpoint || syncEndpoint.startsWith('/')) return '/api/app-version';
  const base = syncEndpoint
    .replace(/\/(?:api\/)?sync\/?$/i, '')
    .replace(/\/api\/?$/i, '')
    .replace(/\/+$/, '');
  return `${base}/api/app-version`;
}

function versionParts(value: string) {
  const [core = '', prerelease = ''] = value.trim().replace(/^v/i, '').split('-', 2);
  const numbers = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return { numbers, prerelease: prerelease ? prerelease.split('.') : [] };
}

/** Compares semantic versions, including prerelease identifiers such as beta.1. */
export function isVersionNewer(candidate: string, current = APP_VERSION) {
  const left = versionParts(candidate);
  const right = versionParts(current);
  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  if (!left.prerelease.length && right.prerelease.length) return true;
  if (left.prerelease.length && !right.prerelease.length) return false;
  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return false;
    if (rightPart === undefined) return true;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber;
    if (leftNumber !== null) return false;
    if (rightNumber !== null) return true;
    return leftPart.localeCompare(rightPart) > 0;
  }
  return false;
}

export async function fetchAppUpdate(syncEndpoint: string): Promise<AppUpdateManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(versionApiUrl(syncEndpoint), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json() as Partial<AppUpdateManifest>;
    if (typeof value.version !== 'string' || !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) {
      throw new Error('invalid version manifest');
    }
    return { version: value.version.replace(/^v/i, ''), prerelease: value.prerelease === true };
  } finally {
    clearTimeout(timeout);
  }
}
