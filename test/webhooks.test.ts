import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWebhookEvent, verifyWebhookSignature } from '../src/webhooks';

const secret = 'whsec_test';
const body = JSON.stringify({
  event: 'enrichment.completed',
  id: 'r1',
  status: 'completed',
});

// Same signing as the Listar API (`services/webhooks/outbound`).
const sign = (raw: string, timestamp = Math.floor(Date.now() / 1000)) =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;

describe('webhooks', () => {
  it('accepts a valid signature', async () => {
    expect(await verifyWebhookSignature(body, sign(body), secret)).toBe(true);
  });

  it('rejects a tampered body or a wrong secret', async () => {
    expect(await verifyWebhookSignature(`${body} `, sign(body), secret)).toBe(
      false,
    );
    expect(await verifyWebhookSignature(body, sign(body), 'other')).toBe(false);
  });

  it('rejects an old signature unless the check is disabled', async () => {
    const old = sign(body, Math.floor(Date.now() / 1000) - 3600);
    expect(await verifyWebhookSignature(body, old, secret)).toBe(false);
    expect(
      await verifyWebhookSignature(body, old, secret, { toleranceSeconds: 0 }),
    ).toBe(true);
  });

  it('takes the header as Express may hand it over (an array)', async () => {
    expect(await verifyWebhookSignature(body, [sign(body)], secret)).toBe(true);
  });

  it('falls back to node:crypto when there is no global crypto (Node 18)', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    });
    try {
      expect(await verifyWebhookSignature(body, sign(body), secret)).toBe(true);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  it('rejects a missing or malformed header', async () => {
    expect(await verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(await verifyWebhookSignature(body, 'garbage', secret)).toBe(false);
  });

  it('parses a verified event and throws otherwise', async () => {
    await expect(
      parseWebhookEvent(body, sign(body), secret),
    ).resolves.toMatchObject({ id: 'r1' });
    await expect(parseWebhookEvent(body, 'v1=bad', secret)).rejects.toThrow(
      /signature/,
    );
  });
});
