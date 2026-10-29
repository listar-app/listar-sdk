import type { components } from './openapi';

type Schemas = components['schemas'];

/** Every event Listar posts to a `callbackUrl`. */
export type ListarWebhookEvent =
  | Schemas['WebhookPayload']
  | Schemas['BatchWebhookPayload']
  | Schemas['CompanyWebhookPayload'];

export type VerifyOptions = {
  /**
   * Rejects signatures older than this, against replays. Defaults to 5 min;
   * 0 disables the check.
   */
  toleranceSeconds?: number;
};

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

/** Signature header as frameworks hand it over (Express may give an array). */
type SignatureHeader = string | string[] | null | undefined;

// Node 18 has no global `crypto`: its Web Crypto lives in `node:crypto`. The
// specifier is a variable so that bundlers for the browser or the edge, which
// all have the global, do not try to resolve a Node built-in.
const NODE_CRYPTO = 'node:crypto';
const subtleCrypto = async (): Promise<SubtleCrypto> =>
  globalThis.crypto?.subtle ??
  ((await import(/* @vite-ignore */ /* webpackIgnore: true */ NODE_CRYPTO))
    .webcrypto.subtle as SubtleCrypto);

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/**
 * Checks the `X-Listar-Signature` header (`t=<timestamp>,v1=<hmac>`) of a
 * webhook against the signing secret (Settings › API keys, or
 * `GET /webhooks/signing-secret`). `rawBody` must be the body exactly as
 * received, before any JSON parsing. Uses Web Crypto: works on Node 18+,
 * edge runtimes and Deno.
 */
export const verifyWebhookSignature = async (
  rawBody: string,
  signatureHeader: SignatureHeader,
  secret: string,
  options: VerifyOptions = {},
): Promise<boolean> => {
  const header = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(timestamp)) return false;

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0 && Math.abs(Date.now() / 1000 - timestamp) > tolerance) {
    return false;
  }

  const encoder = new TextEncoder();
  const subtle = await subtleCrypto();
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = toHex(
    await subtle.sign('HMAC', key, encoder.encode(`${parts.t}.${rawBody}`)),
  );
  return constantTimeEqual(expected, parts.v1);
};

/**
 * Verifies the signature, then parses the event. Throws when the signature
 * does not match. The same event can be delivered more than once:
 * deduplicate on its `id` and `status`.
 */
export const parseWebhookEvent = async (
  rawBody: string,
  signatureHeader: SignatureHeader,
  secret: string,
  options?: VerifyOptions,
): Promise<ListarWebhookEvent> => {
  if (
    !(await verifyWebhookSignature(rawBody, signatureHeader, secret, options))
  ) {
    throw new Error('Listar: invalid webhook signature');
  }
  return JSON.parse(rawBody) as ListarWebhookEvent;
};
