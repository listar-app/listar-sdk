import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/client.ts', 'src/webhooks.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
