# 发布与更新方案

## 网页端与 API

`.github/workflows/docker-publish.yml` 会在默认分支和 `v*` 标签推送时构建并发布两组 GHCR 镜像，均支持 AMD64 与 ARM64：

- `ghcr.io/<仓库>/babyrecord:latest`
- `ghcr.io/<仓库>/babyrecord-api:latest`

NAS 上的 `compose.yaml` 使用 `pull_policy: always`。日常更新只需：

```bash
docker compose down
docker compose up -d
```

家庭访问 PIN 与管理员 PIN 分别来自 NAS 的 `.env`，不进入镜像；前者保护首次进入和同步 API，后者只验证管理员角色。发布镜像也不包含家庭数据。

## Android

推送 `v*` 标签时，`.github/workflows/android-release.yml` 会生成原生工程、使用 GitHub Secrets 中的固定证书签名 APK，并把 `babyrecord-v<版本>.apk` 附加到 GitHub Release。

构建配置分为两类：

- GitHub Actions Variables：`DEFAULT_SYNC_ENDPOINT`、`DOWNLOAD_PROXY_BASE`。它们会进入 APK，属于公开构建配置而非口令。
- GitHub Actions Secrets：Android keystore、别名与密码。家庭访问 PIN 和管理员 PIN 均不进入 GitHub 构建环境。

应用里的下载地址按“代理基础地址 + `github.com/<仓库>/releases/...`”生成。原生权限、Expo SDK 或依赖变化时发布新 APK；未来若启用 EAS Update，可再让同一原生版本接收兼容的 JavaScript 与资源更新。

Android 启动后通过自部署 API 的 `GET /api/app-version` 检查版本，不访问 GitHub API。该接口只公开 API 镜像内的应用版本号和是否为测试版；发现更新后，APK 仍通过 `DOWNLOAD_PROXY_BASE` 配置的代理地址下载。网络或接口不可用时静默退化为仅显示当前版本，不产生误报。

测试版使用语义化预发布版本号，例如 `1.0.6-beta.1`；确认稳定后发布不带后缀的版本，例如 `1.0.6`。发布前必须同步更新 `package.json`、`app.json` 和 `src/config/update.ts` 中的版本号。

签名证书必须长期保存且不可更换，否则已安装设备不能直接升级。建议离线加密保留一份恢复副本，并定期验证能从备份重新签出相同证书指纹的安装包。

本机首次发布时会在 Git 忽略的 `.secrets/android/` 中保留一份权限受限的恢复副本；不要把该目录上传、分享或移入版本控制。
