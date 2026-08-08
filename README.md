# 宝宝日记 UI 原型

面向 Android 与网页端的 Expo / React Native 宝宝记录应用。网页端可通过浏览器“添加到主屏幕”作为桌面快捷应用使用。当前版本已实现版本化本地存储和同步接口原型，完整的多设备增量同步仍在后续阶段。

## 运行

当前 Codex 工作区可直接运行：

```bash
./start.command
```

如果本机已经安装 Node.js 与 pnpm，也可以使用：

```bash
pnpm install
pnpm start
```

启动后可用 Expo Go 扫码，在终端按 `a` 打开 Android Emulator，或按 `w` 直接在浏览器预览。

## 已实现的原型交互

- 按天查看宝宝记录时间表
- 睡眠、活动和洗澡按时间段记录；喂奶、大小便和补充剂默认按时刻记录
- 时间段记录支持直接补齐起止时间，或先开始计时、稍后从今日页快速结束
- 新建自定义项目时可选择“时刻 / 时间段”、颜色和宝宝常用图标，并加入快速记录入口
- 每个用户独立设置主页显示的快捷记录项
- APP 或网页首次进入时验证家庭访问 PIN，成功后保存在当前设备；随后直接显示爸爸、妈妈、已创建角色和自定义入口
- 爸爸、妈妈默认是管理员；选择管理员角色时验证独立的管理员 PIN
- 设置页可切换角色；各角色的快捷项与长辈模式分别保存
- 管理员可修改宝宝资料、管理用户，以及恢复最近 30 天的每日备份
- 宝宝昵称、出生日期与自动年龄计算
- Android 保留同步接口设置；网页端使用部署站点的同源服务，不显示接口设置
- 今日待办、7 日趋势和简单洞察
- 点击日历时间块后编辑时间、标题、内容与备注
- 单屏日历时间网格，时间块可点击编辑
- 今日待办根据最近最多 7 个有效记录日自动生成，不预置演示内容

## 测试

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
```

发布前还会分别执行 Web 与 Android 生产导出，并通过本地同源服务验收家庭 PIN、管理员 PIN、默认记录、自定义记录、跨日期添加、编辑与持久化流程。

## Docker Compose 部署网页端

项目已经包含生产构建、Nginx 静态服务及 GHCR 自动发布工作流。推送到 `main`/`master` 后，GitHub Actions 会发布 `linux/amd64` 与 `linux/arm64` 的 `latest` 镜像。

首次部署时复制 `.env.example` 为 `.env`，分别设置 `ACCESS_PIN` 与 `ADMIN_PIN`，确认 `GHCR_OWNER` 与 GitHub 仓库所有者一致，然后运行：

```bash
docker compose up -d
```

默认映射到 NAS 的 `8080` 端口，可通过环境变量修改：

```bash
BABYRECORD_PORT=8088 docker compose up -d
```

健康检查地址为 `http://NAS地址:8080/health`。Nginx Proxy Manager 只需把你设置的公网入口反代到这个 NAS 端口；域名、证书和公网端口均不由本项目处理。

以后更新网页端只需：

```bash
docker compose down
docker compose up -d
```

Compose 设置了 `pull_policy: always`，第二条命令会拉取新的 `latest` 镜像。GHCR 包建议设为 Public；如果保持 Private，需要先在 NAS 上执行一次 `docker login ghcr.io`。需要在本机直接构建时使用：

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

NAS 自部署与后续同源数据服务设计见 [`docs/NAS_SYNC_ARCHITECTURE.md`](docs/NAS_SYNC_ARCHITECTURE.md)。Android 的默认同步接口在 GitHub Actions 仓库变量 `DEFAULT_SYNC_ENDPOINT` 中配置，用户密码只保存在设备本地。

长期数据版本、迁移与回滚策略见 [`docs/DATA_EVOLUTION_PLAN.md`](docs/DATA_EVOLUTION_PLAN.md)。

网页镜像与 Android 更新方案见 [`docs/RELEASE_AND_UPDATE.md`](docs/RELEASE_AND_UPDATE.md)。

> `ACCESS_PIN` 用于首次设备访问门禁和同步 API 鉴权，`ADMIN_PIN` 只用于管理员角色验证，两者不能混用。同步时客户端通过 `X-Sync-Key` 请求头发送家庭 PIN，不把它放进 URL、代理日志或项目源码。PIN 校验会限制尝试频率；正式同步版还需要服务端会话、权限校验和审计日志。

## 下一阶段建议

- SQLite 本地持久化与离线优先数据层
- 家庭成员账户与云端同步
- 计时器、提醒和锁屏小组件
- 数据导出、儿保报告与更完整的趋势统计
