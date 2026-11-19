# ekko-tools 插件开发指引

先读 README.md、docs/ARCHITECTURE.md、docs/STUDIO_CTX.md、docs/STUDIO_RETURNS.md、
docs/FIELD_REFERENCE.md、docs/HOST_API.md、docs/DEVELOPMENT.md 和 docs/CONTRACTS.md。
精确宿主类型见 sdk/src/index.ts 及其导出的模块；可选 JSON 字段不用时省略，不传 undefined。

- 跨边界及持久化数据结构声明在 contracts/plugin.json，写清每个字段及操作的含义。
- 使用契约校验实际输入、输出和存储，不在 handler 中另定义未登记的公开结构。
- 数据结构变化时直接修改相关 Markdown 和字段说明，解释默认值及兼容/迁移行为，并补充测试。
- 完成前运行 npm run build、npm run lint、npm run harness:check 和 npm test。
- 本插件源码在 src/（TypeScript，esbuild 产出 dist/ 四个自包含 ESM）；contracts/plugin.json
  由 src/server/index.ts 在 apply() 时加载并用 validateModel 校验全部 RPC 入参与返回值。
- 使用真实 run.identity 分区数据（server/adapter/host.ts 的 scope）；登记资源清理并响应 signal。
- 插件 iframe 内的业务一律走 ctx.rpc；禁止在 src/client 直接 fetch/localStorage/直连网络（HC-04）。
  宿主划词浮条运行时在 src/host，注入宿主文档后仅调用本插件 invoke，见 docs/ARCHITECTURE.md。
- 单次文件写入不超过 50 行（本项目协作约定 HC-17）。
