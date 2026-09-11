// Bundles the connector into dist/ (workspace packages inlined, npm deps too),
// so the Docker image needs only `node dist/main.js`.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  // pino loads optional transports dynamically; they are not used in production.
  external: ['pino-pretty'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};

await build({ ...common, entryPoints: { main: 'src/main.ts', rekey: 'src/cli/rekey.ts' }, outdir: 'dist' });
