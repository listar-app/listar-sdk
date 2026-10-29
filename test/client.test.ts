import { describe, expect, it, vi } from 'vitest';
import { Listar, ListarError } from '../src/client';

type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

const fakeFetch = (replies: Reply[]) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: URL | string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected call');
    const text =
      typeof reply.body === 'string'
        ? reply.body
        : JSON.stringify(reply.body ?? null);
    return new Response(text, { status: reply.status, headers: reply.headers });
  });
  return { fn: fn as unknown as typeof fetch, calls };
};

const client = (replies: Reply[]) => {
  const fake = fakeFetch(replies);
  return {
    listar: new Listar({ apiKey: 'sk_live_test', fetch: fake.fn }),
    calls: fake.calls,
  };
};

describe('Listar client', () => {
  it('sends the key and the body, and returns an instant result', async () => {
    const { listar, calls } = client([
      { status: 200, body: { searchResultId: 'r1', success: true } },
    ]);
    const outcome = await listar.enrichPerson({ linkedinSlug: 'jane-doe' });

    expect(outcome).toMatchObject({ status: 'completed', id: 'r1' });
    expect(calls[0].url).toBe('https://api.listar.fr/search/unified');
    expect(calls[0].init.method).toBe('POST');
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe('Bearer sk_live_test');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      linkedinSlug: 'jane-doe',
    });
  });

  it('polls a pending enrichment until it completes', async () => {
    const { listar, calls } = client([
      { status: 202, body: { id: 'r2' } },
      { status: 202, body: { id: 'r2' } },
      { status: 425, body: { id: 'r2' } },
      { status: 200, body: { searchResultId: 'r2' } },
    ]);
    const outcome = await listar.enrichPersonAndWait(
      { firstName: 'Jane', lastName: 'Doe', company: 'Acme' },
      { intervalMs: 1 },
    );

    expect(outcome.status).toBe('completed');
    expect(
      calls.map((c) => c.url.replace('https://api.listar.fr', '')),
    ).toEqual([
      '/search/unified',
      '/search/results/r2',
      '/search/results/r2',
      '/search/results/r2',
    ]);
  });

  it('returns a result waiting for payment instead of throwing', async () => {
    const { listar } = client([
      {
        status: 402,
        body: { id: 'r3', requiresPayment: true, priceInCents: 60 },
      },
    ]);
    const outcome = await listar.enrichPerson({ email: 'jane@acme.com' });
    expect(outcome).toMatchObject({ status: 'payment_required', id: 'r3' });
  });

  it('gives up when the wait times out', async () => {
    const { listar } = client(
      Array.from({ length: 10 }, () => ({ status: 202, body: { id: 'r4' } })),
    );
    await expect(
      listar.waitForResult('r4', { intervalMs: 5, timeoutMs: 12 }),
    ).rejects.toMatchObject({ status: 408 });
  });

  it('throws a ListarError with the API message', async () => {
    const { listar } = client([
      { status: 404, body: { message: 'Search not found', status: 404 } },
    ]);
    const error = await listar.getResult('nope').catch((e) => e);
    expect(error).toBeInstanceOf(ListarError);
    expect(error).toMatchObject({ status: 404, message: 'Search not found' });
  });

  it('exposes Retry-After on a 429', async () => {
    const { listar } = client([
      {
        status: 429,
        body: { message: 'Too many requests' },
        headers: { 'retry-after': '30' },
      },
    ]);
    await expect(listar.getCreditBalance()).rejects.toMatchObject({
      status: 429,
      retryAfter: 30,
    });
  });

  it('waits for the decision makers of a company and unwraps the result', async () => {
    // Shape of GET /company-enrichment/search/{id} (CompanySearchController).
    const company = {
      siren: '123456789',
      contacts: [{ fullName: 'Jane Doe' }],
    };
    const { listar, calls } = client([
      { status: 202, body: { success: true, id: 'c1' } },
      { status: 202, body: { status: 'pending' } },
      {
        status: 200,
        body: { success: true, id: 'c1', result: company, query: {} },
      },
    ]);
    const result = await listar.findCompanyContactsAndWait(
      { domain: 'acme.com', withContacts: true },
      { intervalMs: 1 },
    );
    expect(result).toEqual(company);
    expect(calls[2].url).toBe(
      'https://api.listar.fr/company-enrichment/search/c1',
    );
  });

  it('leaves retryAfter undefined when a 429 has no Retry-After', async () => {
    const { listar } = client([
      { status: 429, body: { message: 'Too many searches running' } },
    ]);
    const error = await listar
      .searchCompanies({ brief: 'SaaS publishers in Lyon' })
      .catch((e) => e);
    expect(error).toMatchObject({ status: 429 });
    expect(error.retryAfter).toBeUndefined();
  });

  it('turns network failures and timeouts into a ListarError', async () => {
    const failing = new Listar({
      apiKey: 'sk_live_test',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(failing.getCreditBalance()).rejects.toMatchObject({
      name: 'ListarError',
      status: 0,
    });

    const hanging = new Listar({
      apiKey: 'sk_live_test',
      timeoutMs: 10,
      fetch: ((_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          ),
        )) as unknown as typeof fetch,
    });
    await expect(hanging.getCreditBalance()).rejects.toMatchObject({
      name: 'ListarError',
      status: 0,
      message: expect.stringContaining('10 ms'),
    });
  });

  it('lets a cancellation by the caller through as is', async () => {
    const controller = new AbortController();
    const { listar } = client(
      Array.from({ length: 5 }, () => ({ status: 202, body: { id: 'r5' } })),
    );
    const waiting = listar.waitForResult('r5', {
      intervalMs: 50,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('stop')), 5);
    await expect(waiting).rejects.toThrow('stop');
  });

  it('calls the global fetch with the right this', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(
        new Response('{"balanceCents":1}', { status: 200 }),
      );
    } as typeof fetch;
    try {
      await expect(
        new Listar({ apiKey: 'sk_live_test' }).getCreditBalance(),
      ).resolves.toEqual({
        balanceCents: 1,
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('passes query parameters and returns the CSV as text', async () => {
    const { listar, calls } = client([
      { status: 200, body: 'date;email\n2026-10-01;a@b.c' },
    ]);
    const csv = await listar.exportSearchesCsv({
      from: '2026-10-01',
      sep: ';',
    });
    expect(csv).toBe('date;email\n2026-10-01;a@b.c');
    expect(calls[0].url).toBe(
      'https://api.listar.fr/history/searches.csv?from=2026-10-01&sep=%3B',
    );
  });

  it('requires an API key', () => {
    expect(() => new Listar({ apiKey: '' })).toThrow(/API key/);
  });
});
