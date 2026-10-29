import type { components, paths } from './openapi';

type Schemas = components['schemas'];

export type PersonQuery = Schemas['UnifiedSearchQuery'];
export type PersonResult = Schemas['UnifiedSearchResponse'];
export type PendingResult = Schemas['PendingResponse'];
export type PaymentRequiredResult =
  | Schemas['PaymentRequiredResponse']
  | Schemas['InsufficientCreditResponse'];
export type CreditBalance = Schemas['CreditBalance'];
export type CompanyContactsResult = Schemas['CompanyEnrichmentResult'];
export type FoundCompany = Schemas['FoundCompany'];

type JsonBody<Op> = Op extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;
type JsonResponse<Op, Status extends number> = Op extends {
  responses: { [K in Status]: { content: { 'application/json': infer R } } };
}
  ? R
  : never;

type BulkOp = paths['/search/bulk']['post'];
type VerifyEmailsOp = paths['/search/verify-emails']['post'];
type VerifyWhatsappOp = paths['/search/verify-whatsapp']['post'];
type VerifyPhoneOwnershipOp = paths['/search/verify-phone-ownership']['post'];
type TransactionsOp = paths['/credit/transactions']['get'];
type ListApiKeysOp = paths['/api-keys']['get'];
type CreateApiKeyOp = paths['/api-keys']['post'];
type CompanyListOp = paths['/company-search']['post'];
type CompanyListPollOp = paths['/company-search/{id}']['get'];
type CompanyContactsOp = paths['/company-enrichment/search']['post'];
type CompanyContactsPollOp = paths['/company-enrichment/search/{id}']['get'];

export type BulkEnrichRequest = JsonBody<BulkOp>;
export type BulkEnrichAccepted = JsonResponse<BulkOp, 202>;
export type VerifyEmailsResult = JsonResponse<VerifyEmailsOp, 200>;
export type VerifyWhatsappRequest = JsonBody<VerifyWhatsappOp>;
export type VerifyWhatsappResult = JsonResponse<VerifyWhatsappOp, 200>;
export type VerifyPhoneOwnershipRequest = JsonBody<VerifyPhoneOwnershipOp>;
export type VerifyPhoneOwnershipResult = JsonResponse<
  VerifyPhoneOwnershipOp,
  200
>;
export type CreditTransactions = JsonResponse<TransactionsOp, 200>;
export type ApiKeyList = JsonResponse<ListApiKeysOp, 200>;
export type CreateApiKeyRequest = JsonBody<CreateApiKeyOp>;
export type CreatedApiKey = JsonResponse<CreateApiKeyOp, 200>;
export type CompanyListRequest = JsonBody<CompanyListOp>;
export type CompanyListLaunched = JsonResponse<CompanyListOp, 202>;
export type CompanyListResult = JsonResponse<CompanyListPollOp, 200>;
export type CompanyListProgress = JsonResponse<CompanyListPollOp, 202>;
export type CompanyContactsRequest = JsonBody<CompanyContactsOp>;
export type CompanyContactsLaunched = JsonResponse<CompanyContactsOp, 202>;
/** A finished company search: `result` holds the company and its contacts. */
export type CompanyContactsSearch = JsonResponse<CompanyContactsPollOp, 200>;

/**
 * Outcome of a person enrichment. An enrichment is not always instant: while
 * data is still being retrieved, the API answers `pending` with an id to poll
 * (or delivers the result to the `callbackUrl` webhook).
 */
export type PersonOutcome =
  | { status: 'completed'; id: string | undefined; result: PersonResult }
  | { status: 'pending'; id: string; result: PendingResult }
  | {
      status: 'payment_required';
      id: string | undefined;
      result: PaymentRequiredResult;
    };

/** Outcome of a polled company search (`pending` while it runs). */
export type PollOutcome<Done, Progress> =
  | { status: 'completed'; result: Done }
  | { status: 'pending'; result: Progress };

export type ListarOptions = {
  /** API key (`sk_live_...`), created in Settings › API keys. */
  apiKey: string;
  /** Defaults to `https://api.listar.fr`. */
  baseUrl?: string;
  /** Custom `fetch` (tests, proxies). Defaults to the global one. */
  fetch?: typeof fetch;
  /** Per-request timeout. Defaults to 120 s. */
  timeoutMs?: number;
};

export type CallOptions = {
  /** Cancels the request. */
  signal?: AbortSignal;
};

export type WaitOptions = {
  /** Delay between two polls. Defaults to 4 s, as the API recommends. */
  intervalMs?: number;
  /** Gives up after this delay. Defaults to 5 min. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Any answer of the API that is not a success the SDK can return, and network
 * failures or timeouts (`status` 0).
 */
export class ListarError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** Seconds to wait before retrying, on a 429. */
  readonly retryAfter: number | undefined;

  constructor(
    message: string,
    status: number,
    body: unknown,
    retryAfter?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ListarError';
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

type RawResponse = { status: number; body: unknown };

const DEFAULT_BASE_URL = 'https://api.listar.fr';
// Above the slowest endpoint (verifyPhoneOwnership, up to a minute).
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Aborts on the caller's signal or after `timeoutMs`, whichever comes first. */
const requestSignal = (timeoutMs: number, signal?: AbortSignal) => {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs,
  );
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
};

const idOf = (body: unknown): string | undefined => {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const id = record.id ?? record.searchResultId;
  return typeof id === 'string' ? id : undefined;
};

export class Listar {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ListarOptions) {
    if (!options?.apiKey) {
      throw new Error('Listar: an API key is required (sk_live_...).');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    // Bound: the native fetch throws "Illegal invocation" when called as a
    // method of another object (browsers, Cloudflare Workers).
    this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.fetchImpl) {
      throw new Error('Listar: no fetch available, pass one in the options.');
    }
  }

  // Person enrichment

  /**
   * Finds the email and/or phone of one person. Identify them as precisely as
   * possible: LinkedIn slug, or name + company (+ city). Billed per data point
   * found; nothing is billed when nothing is found.
   */
  async enrichPerson(query: PersonQuery): Promise<PersonOutcome> {
    return this.personOutcome(
      await this.raw('POST', '/search/unified', { body: query }),
    );
  }

  /** Current state of an enrichment started by `enrichPerson`. */
  async getResult(id: string, options?: CallOptions): Promise<PersonOutcome> {
    return this.personOutcome(
      await this.raw('GET', `/search/results/${encodeURIComponent(id)}`, {
        signal: options?.signal,
      }),
    );
  }

  /** Polls an enrichment until it is no longer pending. */
  async waitForResult(id: string, options?: WaitOptions) {
    return this.poll(
      () => this.getResult(id, { signal: options?.signal }),
      options,
    );
  }

  /** `enrichPerson`, then waits for the result when it is not instant. */
  async enrichPersonAndWait(
    query: PersonQuery,
    options?: WaitOptions,
  ): Promise<PersonOutcome> {
    const outcome = await this.enrichPerson(query);
    if (outcome.status !== 'pending') return outcome;
    return this.waitForResult(outcome.id, options);
  }

  /** Debits the credit to unlock a result waiting for payment. */
  async payWithCredit(id: string): Promise<PersonResult> {
    return this.json('POST', '/search/pay-with-credit', { body: { id } });
  }

  /**
   * Enriches up to 10,000 contacts. The result is pushed once to `callbackUrl`
   * (`batch_enrichment.completed` webhook); there is nothing to poll.
   */
  async bulkEnrich(request: BulkEnrichRequest): Promise<BulkEnrichAccepted> {
    return this.json('POST', '/search/bulk', { body: request });
  }

  // Verification

  /** Checks the deliverability of up to 10 emails. */
  async verifyEmails(emails: string[]): Promise<VerifyEmailsResult> {
    return this.json('POST', '/search/verify-emails', { body: { emails } });
  }

  /** Checks whether phone numbers are active on WhatsApp. */
  async verifyWhatsapp(
    request: VerifyWhatsappRequest,
  ): Promise<VerifyWhatsappResult> {
    return this.json('POST', '/search/verify-whatsapp', { body: request });
  }

  /** Checks that a phone number really belongs to a given person. */
  async verifyPhoneOwnership(
    request: VerifyPhoneOwnershipRequest,
  ): Promise<VerifyPhoneOwnershipResult> {
    return this.json('POST', '/search/verify-phone-ownership', {
      body: request,
    });
  }

  // Companies

  /**
   * Finds the decision makers of one company (SIREN/SIRET, domain or name),
   * with its firmographics. Prefer the domain or the SIRET to a bare name.
   */
  async findCompanyContacts(
    request: CompanyContactsRequest,
  ): Promise<CompanyContactsLaunched> {
    return this.json('POST', '/company-enrichment/search', { body: request });
  }

  async getCompanyContacts(
    id: string,
    options?: CallOptions,
  ): Promise<PollOutcome<CompanyContactsSearch, unknown>> {
    return this.pollOutcome(
      await this.raw(
        'GET',
        `/company-enrichment/search/${encodeURIComponent(id)}`,
        { signal: options?.signal },
      ),
    ) as PollOutcome<CompanyContactsSearch, unknown>;
  }

  async findCompanyContactsAndWait(
    request: CompanyContactsRequest,
    options?: WaitOptions,
  ): Promise<CompanyContactsResult> {
    const { id } = await this.findCompanyContacts(request);
    if (!id) throw new ListarError('Listar: no search id returned', 0, null);
    const outcome = await this.poll(
      () => this.getCompanyContacts(id, { signal: options?.signal }),
      options,
    );
    const { result } = outcome.result as CompanyContactsSearch;
    if (!result)
      throw new ListarError('Listar: empty search result', 0, outcome);
    return result;
  }

  /**
   * Builds a list of companies from a plain-language brief. Billed per company
   * delivered; a brief that matches nothing costs nothing.
   */
  async searchCompanies(
    request: CompanyListRequest,
  ): Promise<CompanyListLaunched> {
    return this.json('POST', '/company-search', { body: request });
  }

  async getCompanySearch(
    id: string,
    options?: CallOptions,
  ): Promise<PollOutcome<CompanyListResult, CompanyListProgress>> {
    return this.pollOutcome(
      await this.raw('GET', `/company-search/${encodeURIComponent(id)}`, {
        signal: options?.signal,
      }),
    ) as PollOutcome<CompanyListResult, CompanyListProgress>;
  }

  async searchCompaniesAndWait(
    request: CompanyListRequest,
    options?: WaitOptions,
  ): Promise<CompanyListResult> {
    const { id } = await this.searchCompanies(request);
    if (!id) throw new ListarError('Listar: no search id returned', 0, null);
    const outcome = await this.poll(
      () => this.getCompanySearch(id, { signal: options?.signal }),
      options,
    );
    return outcome.result as CompanyListResult;
  }

  // Account

  async getCreditBalance(): Promise<CreditBalance> {
    return this.json('GET', '/credit/balance');
  }

  async getCreditTransactions(params?: {
    limit?: number;
  }): Promise<CreditTransactions> {
    return this.json('GET', '/credit/transactions', { query: params });
  }

  /** Every person search over the period, as CSV (3 months by default). */
  async exportSearchesCsv(params?: {
    from?: string;
    to?: string;
    sep?: string;
  }): Promise<string> {
    const { status, body } = await this.raw('GET', '/history/searches.csv', {
      query: params,
      text: true,
    });
    if (status !== 200) throw this.error(status, body);
    return body as string;
  }

  async listApiKeys(): Promise<ApiKeyList> {
    return this.json('GET', '/api-keys');
  }

  /** The key is returned only once: store it right away. */
  async createApiKey(request: CreateApiKeyRequest): Promise<CreatedApiKey> {
    return this.json('POST', '/api-keys', { body: request });
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.json('DELETE', `/api-keys/${encodeURIComponent(id)}`);
  }

  // Transport

  private personOutcome({ status, body }: RawResponse): PersonOutcome {
    if (status === 200) {
      return {
        status: 'completed',
        id: idOf(body),
        result: body as PersonResult,
      };
    }
    // 425: ready, payment being resolved on the API side, poll again.
    if (status === 202 || status === 425) {
      const id = idOf(body);
      if (!id) throw this.error(status, body);
      return { status: 'pending', id, result: body as PendingResult };
    }
    if (status === 402) {
      return {
        status: 'payment_required',
        id: idOf(body),
        result: body as PaymentRequiredResult,
      };
    }
    throw this.error(status, body);
  }

  private pollOutcome({
    status,
    body,
  }: RawResponse): PollOutcome<unknown, unknown> {
    if (status === 200) return { status: 'completed', result: body };
    if (status === 202) return { status: 'pending', result: body };
    throw this.error(status, body);
  }

  private async poll<T extends { status: string }>(
    check: () => Promise<T>,
    options: WaitOptions = {},
  ): Promise<Exclude<T, { status: 'pending' }>> {
    const interval = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline =
      Date.now() + (options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
    for (;;) {
      const outcome = await check();
      if (outcome.status !== 'pending') {
        return outcome as Exclude<T, { status: 'pending' }>;
      }
      if (Date.now() + interval > deadline) {
        throw new ListarError(
          'Listar: still pending when the wait timed out',
          408,
          outcome,
        );
      }
      await sleep(interval, options.signal);
    }
  }

  private async json<T>(
    method: string,
    path: string,
    options?: { body?: unknown; query?: Record<string, unknown> },
  ): Promise<T> {
    const { status, body } = await this.raw(method, path, options);
    if (status < 200 || status >= 300) throw this.error(status, body);
    return body as T;
  }

  private async raw(
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, unknown>;
      text?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<RawResponse> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    const request = requestSignal(this.timeoutMs, options.signal);
    let response: Response;
    let raw: string;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: options.text ? 'text/csv' : 'application/json',
          ...(options.body !== undefined && {
            'Content-Type': 'application/json',
          }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: request.signal,
      });
      raw = await response.text();
    } catch (cause) {
      // A cancellation by the caller is theirs to handle as such.
      if (options.signal?.aborted) throw cause;
      const timedOut = request.signal.aborted;
      throw new ListarError(
        timedOut
          ? `Listar: no answer after ${this.timeoutMs} ms`
          : `Listar: network error (${(cause as Error)?.message ?? cause})`,
        0,
        null,
        undefined,
        { cause },
      );
    } finally {
      request.done();
    }

    let body: unknown = raw;
    if (!options.text || !response.ok) {
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        // Not JSON (a proxy error page): kept as text.
      }
    }
    if (response.status === 429) {
      // Not every 429 carries the header: absent is not "retry now".
      const header = response.headers.get('retry-after');
      const retryAfter = header === null ? NaN : Number(header);
      throw this.error(
        429,
        body,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    return { status: response.status, body };
  }

  private error(status: number, body: unknown, retryAfter?: number) {
    const message =
      body && typeof body === 'object'
        ? ((body as Record<string, unknown>).message ??
          (body as Record<string, unknown>).error)
        : undefined;
    return new ListarError(
      typeof message === 'string'
        ? message
        : `Listar API error (HTTP ${status})`,
      status,
      body,
      retryAfter,
    );
  }
}
