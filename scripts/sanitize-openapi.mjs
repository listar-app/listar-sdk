// The API doc shows a placeholder key (`sk_live_xxxx...`) that secret scanners
// take for a real Stripe key: shortened in the generated types.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../src/openapi.ts', import.meta.url);
const source = readFileSync(path, 'utf8');
writeFileSync(path, source.replace(/sk_live_x{4,}/g, 'sk_live_...'));
