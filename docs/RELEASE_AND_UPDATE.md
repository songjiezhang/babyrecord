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

管理员 PIN 与同步密码来自 NAS 的 `.env`，不进入镜像。发布镜像也不包含家庭数据。

## Android

推送 `v*` 标签时，`.github/workflows/android-release.yml` 会生成原生工程、使用 GitHub Secrets 中的固定证书签名 APK，并把 `babyrecord-v<版本>.apk` 附加到 GitHub Release。

构建配置分为两类：

- GitHub Actions Variables：`DEFAULT_SYNC_ENDPOINT`、`GITHUB_PROXY_BASE`。它们会进入 APK，属于公开构建配置而非口令。
- GitHub Actions Secrets：Android keystore、别名与密码。同步密码和管理员 PIN 不进入 GitHub 构建环境。

应用里的下载地址按“代理基础地址 + `github.com/<仓库>/releases/...`”生成。原生权限、Expo SDK 或依赖变化时发布新 APK；未来若启用 EAS Update，可再让同一原生版本接收兼容的 JavaScript 与资源更新。

签名证书必须长期保存且不可更换，否则已安装设备不能直接升级。建议离线加密保留一份恢复副本，并定期验证能从备份重新签出相同证书指纹的安装包。
