# ekko-tools 契约参考（CONTRACTS）

唯一事实来源是 [`contracts/plugin.json`](<../contracts/plugin.json>)（schemaVersion 1）。
本文是人读摘要；字段级含义以契约文件内每个模型的 description 为准。
`npm run harness:check` 用 vendored SDK（`sdk/harness/`）校验本契约结构与模型方言；
`src/server/contract.ts` 加载同一文件，`src/server/index.ts` 对所有 RPC 入参与返回值执行
`validateModel` 双向校验，违反契约按 `VALIDATION`（入参）/`INTERNAL`（出参，失败关闭）返回。

## 结构总览

- **models（137 个）**：跨边界与持久化结构。嵌套结构无法 `$ref` 引用（契约方言仅允许
  type/description/properties/required/additionalProperties/items/enum/min/max 12 个关键字），
  因此 errorInfo/connectionState/account 等在深层内联，内联副本的 description 指回顶层模型。
- **rpc（62 个）**：每个 RPC 声明 `input`/`output` 模型名。客户端 `call()` 总是注入
  `__requestId`；`__owner` 为内部字段，已在模型中显式登记。
  `translateInput.text` 的 5000 字限制由服务端 `validateRequest` 语义化执行（返回
  `INPUT_TOO_LONG`），不在模型层拦截，避免把可操作错误降级为通用 `VALIDATION`。
  外观 RPC 按身份独立排队，避免被其他设置操作阻塞。保存超时后客户端只回读 `appearance.get`，
  可编辑字段均与提交值一致才确认成功；背景文件名由服务端管理，不参与确认。
  手动保存失败时页面显示随机诊断编号；宿主日志记录该编号及处理阶段，核对读取用同一编号加 `-check`。
  诊断不记录外观值、图片名或图片内容。
  `appearance.save` 通过 `ctx.rpc` 发送 `appearanceSaveInput.wire`（v1 紧凑快照）。
  Studio App 把移动插件请求编码进 WebView 标题，iOS WebKit 发给原生端的标题最多 1000 字符；
  旧版完整 JSON 编码后会被截断，原生端无法解码并回执。紧凑格式不发送字段名或背景文件名，
  顺序由 `src/shared/appearance-wire.ts` 定义；空覆盖延续原有继承/默认值，格式变更需升级版本。
  服务端拒绝不完整或混合格式，仍接受旧版逐字段对象；存储模型、背景文件和刷新事件不变。
- **events（7 个）**：`account.state` / `mail.arrived` / `mail.read` / `mail.deleted` / `translate.progress` /
  `rss.updated` / `appearance.updated`，`audience: plugin`，载荷均带 `eventId` 供客户端去重（事件不保证补发/顺序）。
  `appearance.updated` 只携带 `updatedAt`，其他已打开页面收到后重新读取外观与背景。
- **storage（21 个）**：全部在 `users/{userId}/profiles/{profile}` 分区（legacy settings 在
  `legacy/{userId}/{profile}`），`version: 1` 预留迁移。数组类存储（accounts/mail-cache/
  history）的元素在模型中以"引用顶层模型 + 宽松承载"声明；严格字段以顶层模型为准。
  动态键映射（read/translated/bilingual/images/mail-sync/mail-known/mail-body）用
  `additionalProperties: true`。
  运行时按每次 RPC 重新绑定存储作用域；所有写入先做 JSON 清洗并丢弃 `undefined`。
- **tools/commands/actions/checkpoints**：本插件未使用，显式 `{}`。

## 持久化边界

页面只通过 RPC 读取持久数据；写入按“业务真相可恢复、派生缓存可重建、运行时状态不落盘”分层：
邮件库位于 `dataDir/<partition>/mail/mail.db`，阅读库位于 `dataDir/<partition>/rss/rss.db`。

| 数据 | 位置 | 用途 |
| --- | --- | --- |
| `accounts` / `sync_state` | SQLite | 账号元数据、首次同步、游标、错误与 `knownCount` |
| `messages` / `known_messages` | SQLite | 摘要、未读回退、已见索引；通知只对比该索引 |
| `drafts` / `draft_attachments` | 邮件 SQLite | 每身份最多 100 份草稿与 100 MiB 附件内容；旧库自动增列与建表，原草稿默认纯文本且无附件；删除草稿级联删除文件，移除发件账号不删除草稿 |
| `read_state` / `read_pending` | SQLite | 本机已读与待回写 IMAP 的覆盖值；逐封原子更新，回写成功后清除待回写 |
| `translated_state` / 正文文件 | SQLite + `mail-bodies` | 列表译标记与按需正文，正文索引有容量上限 |
| `bilingual` / `images` | 邮件 SQLite | 有界派生缓存；重启后复用，缺失可重算 |
| RSS 分组/订阅/文章/已读/收藏/设置/抓取运行 | RSS SQLite | 阅读业务真相；刷新、分页与未读统计只读本地库 |
| RSS `summaries` / `digests` | RSS SQLite | 派生结果持久化复用；删除后可按文章或周期重新生成 |
| 翻译历史 `history` | 宿主键值库 | 用户可见业务记录，≤50 条；服务内串行追加，翻译页与邮件双语共享 |
| 翻译结果 `translate-cache` | 宿主键值库 | 有界派生缓存，≤100 条/512KB；丢失后重新请求 Provider |
| `preferences` / `appearance` / 背景元数据 | 宿主键值库 | 小对象偏好与文件索引；密钥只进加密 vault |
| 自定义背景原图 | `dataDir/appearance/*.img` | 大二进制不进键值库，按身份与桌面/移动槽位分文件、按块读取 |
| 首屏、视图与背景 Blob | 客户端内存 + `window.name` | 仅加速页面重挂载，不能作为业务真相 |

仅保存在进程内的是：邮件正文 LRU、双语/远程图片热缓存、翻译缓存热层、媒体代理缓存、
IMAP 连接池与 UIDVALIDITY 快照、RSS 正文提取去重、背景上传分块、后台失败计数、同步互斥与诊断日志。
这些状态均可由 SQLite、文件或网络重建，不能作为未读、已见、通知或业务历史的唯一来源。

## RPC 一览（input → output）

| RPC | 输入 → 输出 | 说明 |
| --- | --- | --- |
| `app.bootstrap` | requestIdOnly → bootstrapOutput | 首屏数据 |
| `app.cancel` | cancelInput → cancelResult | 取消操作，直接返回 Result 信封 |
| `app.diagnostics` | requestIdOnly → diagnosticsOutput | 最近 100 条脱敏诊断 |
| `translate.run` / `translate.retry` | translateInput/retryInput → translationJob | 翻译与重译 |
| `translate.history` | historyInput → translationJobList | 历史查询 |
| `translate.test` | providerTestInput → providerTestResult | 连接测试，不写历史/缓存 |
| `translate.cache-stats` / `translate.cache-clear` | requestIdOnly → cacheStats | 缓存统计与清理 |
| `settings.get` / `settings.save` | requestIdOnly/settingsSaveInput → settingsGetOutput/settingsSaveOutput | 密钥只回 configured；含通知设置 |
| `mail.account.add/rename/remove/test` | addAccountInput/mailAccountRenameInput/accountIdInput → account/removeAccountOutput/connectionState | 账号管理与本地别名 |
| `mail.list` / `mail.get` | mailListInput/mailGetInput → mailPage/mailMessage | 列表与详情 |
| `mail.unread-status` | mailUnreadStatusInput → mailUnreadStatusOutput | 按事件中的邮件 ID 复核当前未读状态；只查本地。已读、未知或不带 ID 的旧事件不弹提醒 |
| `mail.image-domains` / `mail.images` | mailGetInput/imagesInput → imageDomainsOutput/mailMessage | 打开邮件后自动加载远程图片 |
| `media.image` | mediaImageInput → mediaImageOutput | 服务端代取公网 favicon/配图；移动端不直连外链 |
| `mail.attachment` | mailAttachmentInput → mailAttachmentOutput | base64 附件下载 |
| `mail.reply` | mailReplyInput → mailReplyOutput | 通过当前账号 SMTP 回复邮件 |
| `mail.draft.list` / `.get` | mailDraftListInput → mailDraftList / mailDraftInput → mailDraft | 列表不返回正文；详情含正文、可选格式和附件元数据，不返回附件字节 |
| `mail.draft.upload-start` / `.upload-chunk` | mailDraftUploadStartInput → mailDraftUploadStartOutput / mailDraftUploadChunkInput → mailDraftUploadChunkOutput | 暂存附件或草稿快照，上传 ID、base36 已接收偏移、base64url 数据以 `!` 分隔；按身份隔离，15 分钟无活动失效 |
| `mail.draft.commit` / `.upload-drop` | mailDraftUploadRef → mailDraft / mailDraftUploadRef → mailDraftDeleteOutput | 完整快照按 `mailDraftSaveInput` 校验并保存，失败可丢弃未提交暂存 |
| `mail.draft.save` / `.delete` | mailDraftSaveInput → mailDraft / mailDraftInput → mailDraftDeleteOutput | 正文和附件清单原子保存；附件字段省略时保留原清单，空数组清除。删除草稿同时删除附件 |
| `mail.send` | mailDraftInput → mailReplyOutput | 单个收件地址、非空主题，正文或附件至少一个；Markdown 生成 HTML 与纯文本备选，附件通过 MIME 发送。SMTP 接受后删除草稿，不自动重试 |
| `mail.delete` | mailDeleteInput → mailDeleteOutput | 按当前身份的账号和邮件 ID 移入服务器垃圾箱。优先 IMAP MOVE；也支持先复制到垃圾箱，再通过 UIDPLUS 仅移除原邮件。不支持安全移动时失败，不执行全邮箱 EXPUNGE |
| `mail.mark-read` | markReadInput → markReadOutput | 单封已读标记；可选回写 IMAP `\Seen` |
| `mail.mark-all-read` | markAllReadInput → markAllReadOutput | 按账号批量标为已读；可选回写 IMAP `\Seen` |
| `mail.bilingual` | bilingualInput → bilingualBody | 整封正文翻译；仅超长正文分批 |

## 变更约定

`0.1.3`：

- `mail.delete` 成功后移除本机列表与正文、已读和派生缓存，保留用于去重的历史已见 ID，无需迁移；
  `mail.deleted` 通知已打开视图刷新。删除不取决于服务器已读回写设置，且不自动重试。
- `mail.arrived` 增加可选 `messageIds`：只列出合并落库后仍为未读的新邮件；阈值内按 ID 去重，
  已读或并发被标为已读的邮件不再触发提示。
- `mailSyncState` 增加可选 `knownCount`：记录上次同步后的已见索引条数。`initialized=true`
  但当前账号索引为 0 且 `knownCount>0` 时按基线同步处理，修复旧邮件被重新当成新邮件。
- 新增 `media.image`：订阅源 favicon 与邮箱服务商图标改由服务端代取并回传 `data:` URL，
  避免移动端 WebView 拦截插件 iframe 的外链图片；失败时客户端保留字母或本地 SVG 回退。
- `settingsSaveInput` / `settingsGetOutput` / `preferencesModel` 增加 `mailBodyZoom`：
  邮件正文缩放百分比，范围 20–200，缺省 100；切换邮件或重启后沿用上次值。
- `mail.account.rename` 只写本地账号记录，不重测连接、不改凭据；别名最多 6 个字符。
- `rss.feed.rename` 只写本地 `custom_title`；后续刷新不会覆盖用户自定义名称，
  文章列表、详情、简报与 OPML 导出均使用该名称。

0.12.8 变更：

- `rss.feed.add` 在首次抓取时支持 RFC 5005 `rel="next"` 归档链与 JSON Feed `next_url`；
  后续轮询仍只读取主 feed，避免每次同步重复下载全部归档。
- RSS 入库不再固定截断 300 条，统一受 `rssSettings.maxEntriesPerFeed` 约束；默认值提高到 2000，
  契约上限仍为 2000，旧设置按原值保留。
- `rss.entries.list` 的偏移游标与 30 条分页结构不变；前端可连续加载全部本机文章。

0.10.4 变更：

- `mailSyncState` 增加可选 `exhausted`：服务器已确认没有更早邮件后置为 `true`；
  缺省时允许从本地缓存反推一次游标，修复旧状态缺少 `oldestCursor` 后无法续页。

0.10.3 变更：

- `mailListInput` 增加可选 `refresh`：缺省只读本地 `mail-cache`；`true` 时先连接 IMAP
  拉取最新邮件。只有首次使用（无 `mail-sync` 状态）或滚动超过本地缓存时才自动访问服务器。
- `mailPage` 增加可选 `lastSyncAt` 与 `cached`：分别表示所选账号最近一次成功同步时间
  和当前筛选下本地缓存的邮件总数；纯本地读取不会伪造同步时间。
- 新增 `mailSyncState` / `mailSyncMap`、`knownMap`、`storedBody`、`bodyIndexMap`，
  对应 `mail-sync`、`mail-known`、`mail-body`、`mail-body-index` 存储。`mail-known`
  只记录已见 `messageId`，`mail.arrived.count` 只统计不在索引中的新邮件。
- `mail-cache` 上限从 2000 条提升到 20000 条且单值 ≤1.9MB；打开过的正文按
  `mail-body:<accountId>:<messageId>` 单键保存，≤100 封/8MB，单条 ≤1.9MB。
- 新增 `mail.read` 事件：单封已读状态写入本地缓存后推送，供多个界面同步。

0.10.2 变更：

- `account.imap` / `account.smtp` 的常用端口会规范化 `secure`：TLS 端口固定 `true`，
  STARTTLS 端口固定 `false`；旧持久化账号在读取时自动修正，不改变字段结构。
- 邮件列表不再返回“打开查看正文”占位摘要；前端改为滚动触底分页。

0.10.1 变更：

- 修正 `bootstrapOutput.accounts` 的内联账号模型：允许 `provider:"custom"`，并补齐可选
  `username`、`imap`、`smtp`，与 `account` 模型保持一致；此前自建邮箱保存后
  `app.bootstrap` 会因出参校验失败而不刷新账号。

0.10.0 变更：

- `account` / `addAccountInput` 的 `provider` 新增 `custom`；账号增加可选
  `username`、`imap`、`smtp`。自建邮箱必须提供 IMAP 与 SMTP `{host,port,secure}`。
- 新增 `mailReplyInput` / `mailReplyOutput` 与 `mail.reply`：收件人取原邮件 Reply-To/From，
  主题自动补 `Re:`，正文最多 20000 字；输出只返回是否发送成功和可选 Message-ID。
- 内置 163/QQ/Gmail 的 SMTP 预设固定为 465 TLS；自建邮箱 `secure:false` 时强制 STARTTLS。
- `addAccountInput.secret` 同时承载授权码、应用专用密码或自建邮箱密码，仍只入加密 vault。

0.9.2 变更：

- `plugin.json` 增加 `automation` 权限；`apply` 注册 `mail.poll` action，并由
  `scheduler.every('mail-poll', 30000, 'mail.poll')` 每 30 秒刷新当前身份的邮件缓存。
  同一任务不重叠，Studio 重启不补跑。
- `settingsSaveInput` / `settingsGetOutput` / `preferencesModel` 增加 `syncReadReceipts`：
  `true` 时 `mail.mark-read` / `mail.mark-all-read` 通过可写 IMAP 会话同步 `\Seen`；
  默认 `false`，只写本机。
- `markReadOutput` / `markAllReadOutput` 增加可选 `synced`：仅在开启回写时返回；
  服务器写入失败时本地标记仍保留，客户端提示同步失败。
- 开启回写后，`mail.list` 会重新读取已缓存邮件的服务器 flags，外部客户端的已读变化可回显。

0.9.1 变更：

- `mail.list` 增加 `unreadByAccount`：按账号汇总完整未读缓存，而不是只统计当前页。
- 新增 `mail.mark-all-read`：`accountIds` 可选，缺省处理全部账号；只写本地已读映射。
- `settingsSaveInput` / `settingsGetOutput` / `preferencesModel` 增加 `notifications`：
  `enabled`、`dndEnabled`、`dndStart`、`dndEnd`、`mutedAccountIds`；旧数据缺省时按默认值
  回传，保存时补齐完整结构，不改变其他偏好。

0.9.0 变更：

- `mail.bilingual` 仍按批次返回纯译文；客户端在正文原位置直接显示译文，不再提供双语对照。
- 源语言固定自动识别；用户只需选择目标语言并点击一次“翻译”。
- 长邮件由客户端连续调用 `continue` 批次直到完成，失败或中断时才显示继续操作。

0.8.9 变更：

- `mail.bilingual` 改为整封正文一次翻译；只有超过 5000 字才按段落/换行边界分批。
- `bilingualBody.segments` 表示翻译批次而不是句子或自然段，常规邮件固定为 1 项。
- 旧版分段缓存与当前整封文本结构不一致时自动失效并重算。

0.8.8 变更：

- `imagesInput.allowedDomains` 上限从 4 调整为 24，覆盖整封邮件的实际图片域名。
- `mail.images` 逐张容错加载；单张失败或超出正文体积预算不会中断其余图片。
- 邮件 HTML 保留安全样式表与 `class`，服务端和客户端均移除外部 CSS、`url()` 与覆盖定位。

0.8.7 变更：

- 修复 Studio 插件 iframe（`sandbox="allow-scripts"`，无 `allow-forms`）拦截原生表单提交，
  导致“校验并保存 / 保存设置”无任何请求的问题；设置表单改为按钮事件并支持回车提交。
- 邮箱地址与授权码在客户端先行校验，空值或格式错误直接提示，不再静默无响应。

0.8.6 变更：

- 删除 `mode`、`preview`、演示账号和故障注入字段；所有业务请求只使用真实 Provider 与 IMAP。
- 启动时自动清理旧数据中的演示账号、`mode`、`initialized` 与无效 Provider 偏好，
  `settings.get` 同步清洗返回值；保留真实账号和 vault 凭据。
- Provider 枚举固定为 `hostModel`、`baidu`、`deepl`、`openai`；未配置时返回可操作的配置错误。

0.7.0 新增：

- `providerTestInput` / `providerTestResult`：设置页连接测试；失败通过 `error` 返回，
  不产生 RPC 错误，也不写历史或缓存。
- `cacheStats`：`translate.cache-stats` 返回条目数/字节数/时间范围；
  `translate.cache-clear` 额外返回 `cleared` 删除条数。
- Provider 枚举新增 `deepl`；`settingsSaveInput.deeplApiKey` 只入 vault，
  `settingsGetOutput.deeplConfigured` 只回布尔标记。DeepL 密钥以 `:fx` 结尾使用免费端点。

0.6.0 新增：

- `glossaryEntry`：术语表条目 `{source,target}`；`settings.get/save` 可读写最多 100 条。
- `translate-cache` storage：键为 `provider/from/to/text/glossary` 哈希，值为 `{at,job}`；
  最多 100 条/512KB，命中时 `translationJob.cached=true`。
- `providerResult`、`translateInput`、`retryInput`、`settingsSaveInput` 的 Provider 枚举新增
  `openai`；OpenAI 兼容配置为 `openaiBaseUrl`、`openaiApiKey`（secret）、`openaiModel`。

结构变化时：改 `contracts/plugin.json`（每个字段写清 description 与默认值）→ 同步本文件 →
补/改测试（`tests/unit/contract-models.test.ts` 校验模型拒绝与通过用例）→ 跑
`npm run harness:check` 与 `npm test`。凭据类字段只允许出现在 `addAccountInput.secret` 与
`settingsSaveInput.secret`（一次 RPC 进入加密 vault），任何输出模型不含 secret 字段。
