import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', fileParallelism: false, testTimeout: 15000,
coverage: { provider: 'v8', include: ['src/server/vault/*.ts','src/server/log.ts','src/server/mail/sanitize.ts'], reporter: ['text','json-summary','html'], thresholds: { lines: 90, functions: 90, statements: 90 } } } });
