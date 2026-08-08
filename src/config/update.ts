export const APP_VERSION = '1.0.4';
export const ANDROID_APK_NAME = `babyrecord-v${APP_VERSION}.apk`;

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
