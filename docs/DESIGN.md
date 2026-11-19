# ekko-tools UI/UX 设计规范（DESIGN）

完整设计依据（token 来源标注、线框、13 类状态定义、a11y 清单）见项目级
[uiux-spec.md](<../../docs/uiux-spec.md>) 与 [uiux-report.md](<../../docs/uiux-report.md>)。
本文是组件与 token 用法速查。

## 主题令牌（--dsw-alias-* 的映射目标）

插件运行在宿主 iframe，颜色与材质由 `design-tokens.css` 按导出主题值自包含，
避免宿主亮色主题覆盖；字体、字号、圆角、控件高度、边框宽度、字距与间距读取宿主主题变量。
禁止在业务样式硬编码颜色、禁止 backdrop-filter（宿主主题 blur=0）。用户主题基准（comic 风格导出）：
controlHeight=41、borderWidth=2.5、global radius=23、card radius=21、input radius=20、
spacing=1.1、letterSpacing=-0.6——与 `src/client/styles/design-tokens.css` 快照逐值一致。

| 用途 | 变量（导出主题值） |
| --- | --- |
| 圆角 | --ek-radius-global 23px、--ek-radius-card 21px、--ek-radius-input 20px、--ek-radius-chrome 15px |
| 控件 | --ek-control-h 41px、--ek-border-w 2.5px |
| 间距 | --ek-sp-1..6 = 4..28px × --spacing-scale(1.1) |
| 文字 | --ek-text #ecf1fa、--ek-text-2 #aabbd3、--ek-text-muted #8ea4c2，对比度均 ≥5:1 |
| 状态 | --ek-info #98b9f5、--ek-success #a9c8bd、--ek-error #d8aaa4、--ek-warning #d9c49c |
| 来源色 | --ek-src-163/qq/gmail（Okabe-Ito 色盲友好系加深） |

插件固定深色，不依赖宿主亮暗；字号使用 `--font-size-base`，间距使用 `--spacing-scale`。

0.9.1 增补：基础底色 #122440；面板/卡片/输入分别使用 76%/80%/68% 深蓝表面，
背景照片只在空白区域透出，表单与阅读正文保持可读。主题包背景图复制到
`assets/panel-bg.jpg`，由构建期 data URL 注入 `--ek-bg-image`；36px 小控件用于列表与图标按钮，
41px 控件用于语言栏、表单与主按钮。

0.9.2 增补：`automation` 权限注册 `mail.poll`，Studio 运行期间每 30 秒后台刷新邮件缓存；
邮箱设置增加“同步已读到邮箱服务器”开关，默认关闭，开启后只对 `\Seen` 执行 IMAP STORE；
写入失败保留本机待同步覆盖，服务器确认一致后清除。

0.10.0 增补：新增 `custom` 邮箱，IMAP 收信、SMTP 回复，支持 TLS/STARTTLS 和可选登录名；
内置 163/QQ/Gmail 同样具备 SMTP 回复。详情页回复表单原地展开，不改变阅读与翻译布局。

0.10.8 增补：直接套用导出的 Ekko Studio 主题。原图复制为 `assets/panel-bg.jpg`，
主题参数保存为 `assets/theme.json`；`theme-studio.css` 作为最后一层覆盖，统一工作区背景、
品牌头部、玻璃卡片、翻译双栏、邮件三栏、详情阅读和设置页。背景按 `center top` 铺满，
来源角标与头像继续使用 163/QQ/Gmail 识别色，token 优先读取宿主变量并以导出主题值回退。

0.10.9 增补：品牌头部收紧到 78px，移除重复英文眉题；所有字符图标改为 24×24 SVG 描边图标，
图标按钮保留 `aria-label` 并补充 `title`。翻译语言栏与服务选择组成响应式双列工具行，
窄屏回落单列；空译文、邮件空阅读区和禁用主按钮使用统一低强调层级。文件夹、邮件行和设置导航
的选中态改为整块背景、边框与内高光，不使用左侧色条。

0.10.10 增补：字体与主题几何量改为跟随 Ekko Studio 实时主题。宿主在 iframe 根元素注入
`--font-family`、`--font-size-base`、`--radius-component`、`--theme-card-radius`、
`--theme-input-radius`、`--control-height`、`--border-width`、`--letter-spacing` 与
`--spacing-scale`；`theme.ts` 将其映射到 `--ek-*` token，并通过 MutationObserver 响应主题切换。
字体文件按宿主同名 `@font-face` 从同源 `/fonts/*.ttf` 加载，因此 comic 主题的
Comic Neue / ZCOOL KuaiLe 在插件内同样生效。主题由 Studio 保存与下发，插件不另存副本。

0.10.11 增补：工作区背景不再叠加深色渐变与 scrim，直接使用主题照片，亮度与 Studio 侧边栏一致；
面板、卡片、输入框透明度分别下调到 0.40/0.48/0.44，保留深蓝玻璃可读性。原生 `<select>`
统一 `color-scheme: dark`，option 使用 `--ek-bg-solid` 背景、`--ek-text` 文字与
`--ek-accent` 选中态。品牌标识改为纯描边简笔画（信封 + 星芒），头部不再使用圆球，
源文件为 `assets/brand.svg`，组件为 `src/client/components/BrandMark.tsx`。

0.10.12 增补：设置页新增“外观”分区。默认跟随 Studio，自定义时写入独立的 `--ek-font-*`、
`--ek-fs-base`、`--ek-radius-*`、`--ek-control-h`、`--ek-border-w`、`--ek-spacing-scale` 与
`--ek-ls`；强调色、背景压暗和模糊通过 `--ek-accent`、`--ek-bg-overlay-color`、`--ek-bg-blur`
即时预览。背景图改为工作区伪元素层，支持自定义 data URL 与 `center top` 铺满；上传图在
客户端不缩放、不重编码，原图经 675KB 分块写入 `paths.dataDir/appearance`，存储只保留元数据；
未上传时继续使用 `assets/panel-bg.jpg`。读取端按 525KB 分块拼成 Blob，并即时切换到对象 URL。

0.10.13 增补：HTML 邮件正文 iframe 保持 `allow-scripts` 关闭，只增加 `allow-same-origin`
以读取 iframe 选区；`SelectionPopover` 监听正文 `selectionchange`，把选区和浮条位置映射回插件面板。

0.10.14 增补：iframe 的 Window/Document 会在 `srcdoc` 加载时替换，选区监听改为在每次 `load`
后按当前文档重新绑定；划词按钮读取最新目标语言。iframe 内选区存在时，外层文档的空
`selectionchange` 不再关闭浮条，仅在面板内重新选区或点击时更新。

0.10.15 增补：Studio 插件桥没有对话页浮层接口。插件页挂载时把 `src/host/selection-overlay.ts`
的自包含运行时注入宿主文档（同源 frame），在对话页、邮件页等宿主页面监听划词，浮条使用
宿主 `--text-primary` / `--bg-secondary` / `--border-color` / `--accent-color` 变量和 Shadow DOM，
不会继承宿主按钮样式。译文通过宿主同源的 `/api/studio/plugins/ekko-tools/invoke` 调用插件
`translate.run`，只发送用户明确选中的文本；浮条默认自动翻译，可复制、重译或关闭。

0.10.16 增补：翻译页默认目标为“自动（中↔英）”，执行前按输入文本判断方向：中文译成英文，
英文译成中文；显式选择其他目标语言时保持用户选择。输出区移除“对照 / 仅译文”切换，只渲染译文。
宿主浮条与面板浮条共用 `pickTranslationTarget`，缓存键、请求目标和重译方向都按当前选区计算。

0.10.17 增补：翻译页在停止输入约 900ms 后自动执行，`Enter` 立即执行，`Shift+Enter` 换行；
输入法组词期间不提交，组词结束或继续输入会重新调度。新输入会立即作废旧请求，避免迟到结果覆盖。
主翻译按钮、最近翻译列表与底部快捷键提示已移除，页面只保留翻译编辑区和译文操作。

0.12.0 增补：阅读新增“发现订阅源”覆盖面板，覆盖三栏但不跳转页面；内置 70 个真实抓取
验证过的订阅源，按 9 个主题分类，支持关键词搜索、订阅到分组、一键订阅和已订阅状态。
AnyFeeder 桥接源在卡片上标注 `via`，订阅后仍写入本机 SQLite。面板使用深蓝玻璃表面、
主题 token 和独立滚动区，窄屏回落单列卡片。

0.12.1 增补：阅读三栏改为弹性列宽，订阅源栏可收起，980px 以下切换为抽屉式来源导航；
点击文章后列表列收起，正文占满列表与详情区域并提供返回列表；详情页另有专注阅读，隐藏两侧栏
并居中放宽正文。文章打开态使用独立 `article-open` 类，避免与翻译输出区 `.reader` 的
`max-height:420px` 冲突；阅读网格固定为 `minmax(0,1fr)` 单行并占满可用高度。订阅源改为连续
树状导航，选中态与主导航统一使用轻背景与文字提亮。文章 iframe 使用 720px 版心、衬线字体与 1.85 行高，
图片、图注、引用、代码块和表格分别适配，长文在详情区独立滚动。

0.12.2 增补：阅读正文移除顶部 AI 摘要条，改为正文工具条的 AI 解读入口。解读使用文章页内的
非模态浮窗，不脱离文章、不参与阅读网格布局，文章保持可见可滚动；浮窗可拖拽、Esc 关闭，
底色提高为接近实色的深蓝玻璃，避免文章图文透底影响阅读。摘要按需生成并缓存在文章记录中，
生成失败在浮窗内显示真实错误。AI 服务地址、密钥、模型与摘要语言统一放在“设置 → 阅读设置”。

0.12.7 增补：邮件账号、摘要索引、已读/翻译状态与图片缓存改存独立 SQLite（`mail/mail.db`），
正文按消息哈希写入 `mail-bodies`，宿主键值库只保留偏好等小对象，绕开 2MB 单键上限；
旧键值与旧正文文件首次启动自动迁移，单条失败保留原数据。订阅源新增失败次数、下次抓取时间、
最近状态和 `feed_runs` 抓取日志，失败按指数退避，手动刷新可绕过。阅读发现面板收紧为
860px / 70% 高度，弹窗底色改为深蓝实色混合，阅读信息页保持插件统一材质；订阅图标按站点地址
补全相对路径，缺失时回退站点 favicon。侧栏订阅源行统一 36px 高、8px 内边距、22px 图标与
2px 行距，与分组行保持同一规格；订阅源可拖拽到分组或“未分组”。文章列表采用滚动监听 +
IntersectionObserver 双通道分页，接近底部或内容不足一屏时自动加载下一页。

0.12.8 增补：RSS 首次订阅会识别 Atom/RSS 的 RFC 5005 `rel="next"` 与 JSON Feed `next_url`，
连续抓取源声明的历史归档页并去重入库；无归档声明的源只保存其实际返回的文章。单次响应不再
截断前 300 条，入库与裁剪统一使用“每源文章上限”，默认 2000。列表继续使用 30 条一页的本地
无限滚动，最后一页显示真实总数；源端没有下一页时，本地分页只覆盖已抓取的数据。

0.12.9 增补：阅读列表把来源与时间固定在整行顶部，缩略图从下一行开始并与标题、摘要对齐。
正文 iframe 在可滚动区域内监听滚轮边界：顶部继续上滑打开当前筛选/订阅源的上一篇，底部继续
下滑打开下一篇；当前本地页用完时先请求下一页，再切换到新文章。
阅读详情与邮件列表沿用同一信息层级：来源或邮箱账号标签在头像上方，头像、标题与摘要从下一行开始。

0.12.14 增补：阅读详情头部拆为两行：第一行是独立胶囊返回按钮与右侧图标工具栏，第二行是文章
标题与元信息；返回按钮使用箭头徽标、单行文字与轻量玻璃底，不再被图标按钮的网格布局压成两行。
阅读设置新增正文主题、字体、字号、行高、版心宽度和自定义 CSS；主题提供纸白、暖褐与深色，
字体提供衬线、无衬线与等宽。预设样式与用户 CSS 依次写入文章 iframe，数值在服务端收敛到安全范围，
自定义 CSS 渲染前移除 `url()`、`@import`、固定/粘性定位和脚本类声明。旧设置缺少新字段时自动
回退 `paper + serif + 16px/1.85 + 720px`，不迁移也不清空已有订阅。

0.1.2 增补：阅读设置新增抓取代理，默认 `system` 依次读取环境变量、Windows 注册表与 macOS
`scutil`，`custom` 只接受 HTTP/HTTPS 地址，`none` 直连；`NO_PROXY` 与 Windows
`ProxyOverride` 对系统代理生效，自定义地址在服务端规范化后再持久化。首屏数据与外观按插件
和身份缓存在 iframe 的 `window.name`（仅当前页面内存，随 iframe 销毁清除），宿主重载视图
时可直接复用；面板内切换保留已打开视图。
首次进入显示骨架，后续切换先按缓存渲染并在后台刷新；外观请求立即执行，邮件与阅读在首次
加载完成前显示加载态。

0.12.15 增补：发现订阅源面板移除 “EKKO READING” 眉题，内置来源从 70 个收敛为 9 类各 3 个
高热度代表源，共 27 个。邮件列表底部状态条已移除，同步入口保留在列表标题栏；账号异常仍在该栏上方
以警告卡提示。账号筛选、文件夹切换与搜索会关闭旧详情，避免阅读窗格显示不属于当前范围的邮件。
`unreadByAccount` 始终统计完整本地缓存，单账号筛选只裁剪列表条目，不改变其他账号的未读徽标。

## 组件清单（src/client）

| 组件 | 职责 | 备注 |
| --- | --- | --- |
| App | slot 分流（workspace/settings）、首屏骨架、面板内模块切换 | 工作区不显示顶部工具栏；键盘 Alt+1/2/3 切翻译/邮件/阅读；设置入口在主侧栏 |
| Translate | 语言栏/服务切换/字数/复制/重译/中英自动方向 | 停止输入自动翻译；Enter 立即翻译、Shift+Enter 换行；仅显示译文 |
| SelectionPopover | 面板内划词浮条：译 / 送入翻译 | 仅插件 DOM，见 G07 回归测试 |
| studio-selection | 把自包含运行时注入宿主文档，提供对话页划词浮条 | 同源注入；`toString` 路径有独立 realm 回归测试 |
| Mail | 统一收件箱：账号筛选、搜索、完整未读统计、全部标为已读、列表 | listbox + roving tabindex，R 键同步；后台 30 秒 + 页面内 60 秒静默同步；当前筛选内批量已读 |
| MailDetail | 详情：打开即已读、原地翻译、原地回复、附件、远程图片自动加载 | 已读状态即时回写列表；回复走当前账号 SMTP |
| Reading | 三栏阅读器：分组/订阅源、文章列表、正文与 AI 摘要 | 本地 SQLite 分页、无限滚动、OPML、全文提取、今日简报；来源栏可收起，支持专注阅读；发现面板提供分类精选源与一键订阅；详情返回按钮独立于图标工具栏 |
| Settings | 独立设置页：邮箱账号、翻译服务、阅读设置、外观、通知、缓存与诊断 | 阅读设置控制摘要服务/模型/语言、轮询、保留、图片、正文主题/字体/版心与自定义 CSS；外观支持跟随/自定义主题；邮箱支持自建 IMAP/SMTP、服务器已读回写 |
| States | 13 类空/加载/错误态（图标 + 语义角色） | error→alert，loading→aria-busy+骨架 |
| Tabs | 通用 tablist，方向键/Home/End roving tabindex | 传中文值数组 |
| MailBodyFrame | 正文 sandbox iframe（无 allow-scripts，meta CSP 兜底） | 支持同源划词桥接；安全外链可点击并在新窗口打开 |
| i18n | zh/en 文案集中；zh 串即 key，en 环境映射；window.__ekkoLocale 可覆写 | 服务端错误消息暂保持中文 |

## 布局与可访问性

- 邮件、翻译与阅读工作区铺满宿主内容区，取消居中限宽，也不显示顶部“工具箱”栏；
  设置入口作为主侧栏第四项，设置页保留独立阅读宽度。窄屏单列且无横向滚动。
- 设置视图使用 `workspace` slot 以获得主侧栏入口，客户端按 `view=settings` 渲染独立设置页；
  不再依赖宿主设置侧栏分组。
- 阅读为 196–224px / 296–352px / 自适应三栏；来源栏可手动收起，980px 以下为抽屉式导航；
  专注阅读只保留正文，文章 iframe 使用 720px 版心并在窄屏收缩内边距。
- 所有可交互元素为原生 button/input/select/a 或带 role+tabindex；焦点环 2.5px 引用 --accent-info。
- 键盘：Tab 顺序即阅读顺序；列表上下键移动、Enter 打开、Esc 返回；浮条 Esc 关闭。
- 文案 zh/en 集中于 `src/client/i18n.ts`（zh 字符串即 key）；测试经 `window.__ekkoLocale='zh'` 锁定。

## 启动性能

- RPC 按 `app` / `mail` / `mail-poll` / `translate` / `rss` / `rss-poll` / `rss-ai` 分队列。
  后台 IMAP 同步、RSS 抓取和 AI 摘要相互隔离，也不占用页面交互队列：
  轮询被调度器取消或等待网络时，`mail.list` / `rss.list` 仍可直接读取本地缓存并立即返回。
- `app.bootstrap` 不拉取宿主模型目录；模型只在真正翻译时解析。账号与翻译服务并行读取。
- 密钥库使用 30 秒内存快照并按文件时间校验，避免首屏重复 scrypt 解密。
- 背景与外观设置延后到空闲时加载，界面骨架先渲染。
- 阅读数据库与订阅在进入阅读视图时才打开；切换模块不触发 RSS 抓取。
