# NAS 自部署与同步方案

## 推荐结论

APP 采用“客户端本地数据 + NAS 同源数据服务”的结构。Android 可以离线记录并通过 HTTPS 增量同步；网页端由 Docker Compose 部署，通过当前站点的同源路径访问后续数据服务，不提供同步地址设置。

Android 默认同步入口由构建环境变量 `EXPO_PUBLIC_DEFAULT_SYNC_ENDPOINT` 注入，并保留设备内设置入口。网页端固定使用相对路径 `/sync`，由同一 Docker Compose 网络中的 Web 服务转发，外部域名、HTTPS 证书和端口交给现有的 Nginx Proxy Manager。

WebDAV 适合作为备份、导出或低频文件同步层，不建议让多个手机直接读写同一个 SQLite 数据库文件：共享数据库文件容易在网络中断、并发上传或覆盖时损坏。

## 数据流

```text
Android / Web
  └─ SQLite / IndexedDB 本地存储
       └─ 增量同步（HTTPS）
            └─ NAS 上的 Sync API
                 ├─ PostgreSQL 数据库
                 ├─ NAS 数据卷备份
                 └─ 可选：加密快照上传至 WebDAV
```

## Docker Compose 服务

当前 Compose 已包含 `web` 与轻量 `api`，用于静态网页、首次家庭访问 PIN 校验和同步鉴权原型。正式功能阶段建议扩展为：

- `api`：提供登录、宝宝档案、记录增删改查、增量同步和家庭成员权限。
- `postgres`：保存结构化数据，数据卷映射到 NAS 指定目录。
- `backup`：每天定时生成加密备份，保留最近 30 个自然日，可复制到 NAS 文件夹或 WebDAV 目录。
- `reverse-proxy`：可选 Caddy/Nginx，负责 HTTPS 和局域网域名。

当前 UI 原型已经提供 `compose.yaml`、多阶段 Web 构建、轻量 API 和容器内 Nginx，默认映射 NAS 的 `8080` 端口。正式数据功能确定后，再在同一 Compose 中加入 `postgres` 和 `backup` 服务；公网反代配置不进入本仓库。

`ACCESS_PIN` 必须放在 NAS 的 `.env` 或 Docker Secret 中，没有仓库默认值，也不会注入网页或 APK。它在设备首次进入时验证，并自动作为同步密钥；客户端通过 `X-Sync-Key` 请求头发送，避免出现在 URL、Nginx Proxy Manager 日志和浏览器历史中。升级兼容期内服务端仍接受旧变量名 `ADMIN_PIN`，同步接口也暂时兼容旧请求头 `X-Sync-Password`。

如果只在家庭网络访问，建议通过 NAS 自带反向代理或 Tailscale/WireGuard 接入，不直接把数据库或 WebDAV 端口暴露到公网。

## 同步与冲突

每条记录使用全局 UUID，并包含：

- `created_at`、`updated_at`
- 单调递增的 `revision`
- `device_id`、`author_id`
- 删除标记 `deleted_at`，避免离线设备把已删除数据重新上传

客户端上传“上次同步后发生的变更”，服务端返回新的游标和远端变更。不同设备修改同一条记录时，普通字段可按最新修订合并；时间、奶量等关键字段发生冲突时保留两个版本并让用户确认。

## 今日待办生成规则

待办在客户端根据已同步的真实记录生成，不依赖云端 AI：

1. 获取最近 7 个有数据的自然日；不足 7 天就使用现有天数。
2. 按项目计算典型时间，优先使用中位数，减少偶发晚睡或漏记的影响。
3. 喂奶同时计算相邻记录的典型间隔；睡眠计算开始时间范围和平均时长。
4. 铁剂和维生素类按用户设定的每日/隔日频率生成，并参考最近完成时间。
5. 置信度过低时显示“参考时间”，不发送强提醒；完全没有数据时使用用户手动设置的计划。
6. 建议待办与真实记录分开保存，只有用户完成或产生实际记录后才进入健康数据。

## 功能阶段实施顺序

1. 本地 SQLite 数据模型、计时器和可靠的离线记录。
2. 待办规则引擎与本地通知。
3. Docker Compose API、PostgreSQL 和单设备同步。
4. 多成员权限、冲突处理和审计记录。
5. 数据导出、恢复演练与长期版本兼容。

数据结构、APP 与 NAS 的长期版本兼容策略见 [`DATA_EVOLUTION_PLAN.md`](DATA_EVOLUTION_PLAN.md)。
