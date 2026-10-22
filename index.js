// OpenCode's local-plugin resolver looks for a literal `index.*` or `server.*`
// file directly in this directory — it does not consult package.json's
// "main"/"exports" field for local (non-npm) plugin directories (see
// packages/util/src/runtime/import.{node,bun}.ts + packages/plugin/src/host.ts
// in the opencode source). This shim exists purely to satisfy that
// convention; the real implementation is built to dist/ by `npm run build`.
export { default } from './dist/index.js';
