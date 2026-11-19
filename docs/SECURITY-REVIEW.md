# ekko-tools 安全评审（SECURITY-REVIEW）

范围：0.10.2 阶段代码与依赖；自建 IMAP/SMTP 已完成实网联调，其他真实供应商联调未执行。对应任务书 §3/§4 的
威胁建模要求；深度事实核对见项目级 [fact-check.md](<../../docs/fact-check.md>)、
[decision-log.md](<../../docs/decision-log.md>) 与 [implementation-report.md](<../../docs/implementation-report.md>)。

## 1 权限清单（最小化）

| 声明 | 用途 | 不做什么 |
| --- | --- | --- |
| api.read / api.write | run.identity 分区存储（账号元数据、缓存、偏好） | 不写 dataDir 之外的宿主文件系统 |
| ui | 侧栏/页面挂载、confirm/notify/navigate | 不访问宿主页面 DOM 或选区（HC-14） |

不声明 agent/tools 权限；不调用宿主账号/密钥管理接口。IMAP 默认只读；只有用户开启
“同步已读到邮箱服务器”后才发送 `STORE \Seen/\Unseen`。回复仅通过用户配置的
TLS/STARTTLS SMTP 发送，不执行 EXPUNGE，不访问其他邮箱目录。

## 2 凭据处理（威胁：明文泄露）

- 授权码/应用密码/自建邮箱密码只在 `mail.account.add` / `settings.save` 入参出现一次（契约仅这两个模型含
  secret 字段），立即 AES-256-GCM 加密写入 `dataDir/vault.bin`；密钥来自 scrypt(vaultPassphrase)
  或 dataDir 随机 `vault.key`。
- 输出模型无 secret 字段；`redact()` 对键名 /pass|secret|token|auth|cookie|code/i 输出 [REDACTED]，
  正文类字段 [OMITTED]，邮箱仅 SHA-256 前 8 位哈希；85 项测试含 secret 不落盘断言。
- `Account`/`MailSummary` 等前端结构零凭据；诊断导出经同一 redact 管线。
- 已知限制（G11）：vault.key 与 vault.bin 同 OS 用户可读；口令轮换未实现；宿主 secret 配置落盘
  由宿主保证。**不得宣称系统级钥匙串安全。**

## 3 越权与注入（威胁：越权访问/脚本执行）

- 分区：所有存储经 `scope(run)` = user+profile 哈希分区；accountId 仅为查找键，不决定归属。
- 邮件正文三道防线：服务端 sanitize-html 白名单清洗 → 客户端 sanitizeClient 复检 → 无脚本
  sandbox iframe（meta CSP 兜底）；M1/M2 恶意样本 fixtures + 22 项安全测试覆盖脚本/事件/CSS/
  javascript: 变体/跟踪像素。
- 远程图片由客户端在打开邮件后自动请求；`mail.images` 仍需 confirmed=true + HTTPS 域名白名单（≤24 个），白名单只来自本封正文实际引用地址；
  逐张容错加载并受正文体积预算限制；最多跟随 3 次 HTTPS 重定向且每次重新校验公网 IP，
  加载结果持久化，避免重复出网。
- SMTP 强制 TLS 或 STARTTLS，并校验服务器证书；添加自建账号时同时验证 SMTP 登录，
  `mail.reply` 只接受当前分区账号和邮件 ID，收件人由服务端从原邮件解析，正文最多
  20000 字，禁止客户端指定任意 SMTP 服务器。
- 附件：危险扩展名/MIME 拒绝下载；大小双重校验（声明 + 实际字节）≤maxAttachmentMB。

## 4 网络与超时（威胁：超时泄漏/资源失控）

- 单次 RPC 出参/入参经契约 validateModel（失败关闭）；自动重试仅 retryable 错误、≤3 次、
  总耗时 ≤90s（宿主上限 120s）；AbortSignal 贯穿 connector/翻译/图片抓取；视图卸载经 app.cancel
  取消挂起操作。
- 添加账号与手动重连使用 10 秒单次限时校验，不进入自动重试；SMTP 回复不自动重试，
  避免服务器已接收后重复发信。
- DeepL 固定官方 HTTPS 端点（免费/付费按 `:fx` 后缀选择）；OpenAI 兼容仅允许 HTTPS 或本机 HTTP，
  拒绝 URL 内嵌凭据；连接测试受同一超时与取消边界约束。
- IMAP 使用 30 秒空闲连接池复用 TLS 会话；SMTP 每次发送后关闭连接。
  尚无 IMAP IDLE/服务器推送，后台每 30 秒定时同步。

## 5 依赖与供应链

| 依赖（固定精确版本） | 上游 | License | 状态 |
| --- | --- | --- | --- |
| imapflow 1.7.8 | postalsys/imapflow | MIT（package.json 实抓核实） | 官方 registry 审计 0 告警 |
| mailparser 3.14.3 | nodemailer/mailparser | NOASSERTION（LICENSE 全文未读） | 同上 |
| sanitize-html 2.18.2 | —— | —— | 同上 |
| react / react-dom 19.2.0 | —— | —— | 同上 |

- 生产依赖定向升级历史与审计证据：`docs/evidence/enterprise-audit-02.log`（0 告警）、
  `enterprise-dependencies.log`。安装全程 `--ignore-scripts`，package-lock 固定 integrity。
- vendored `sdk/`（harness+类型+guide）来自宿主基线仓库逐字节校验和一致复制；运行时零 npm 依赖。
- 参考（未引入代码）：DOMPurify（Apache-2.0）、LibreTranslate（GPL-3.0）、Argos（MIT? 待核）、
  citrusmail、Nodemailer——license 结论见 docs/oss-references.md；GPL/AGPL 代码禁止复制。

## 6 未验证项（不得据此宣称安全验收通过）

1. 真实百度密钥与 163/QQ/Gmail 授权码端到端从未执行（出站 TCP 993/TLS 未验证）。
2. mailparser/LICENSE 与 EmailEngine 自定义许可全文未读。
3. 全 RPC 成功响应的 canary 扫描与运行时日志扫描未做（现有为 dist/fixture 静态扫描）。
4. Windows 下 dataDir ACL 未验证；宿主侧 secret 配置加密由宿主负责，插件无法证明。
5. 真实浏览器 XSS 探针（M1/M2 在 sandbox iframe 中 window.__xss 未置位）需浏览器级验收（F 项执行）。
