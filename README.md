# @listar-app/sdk

Official TypeScript SDK for the [Listar](https://listar.fr) API: verified B2B emails, phone numbers and the decision makers of any company.

- Typed from the Listar OpenAPI spec
- No runtime dependency, works on Node 18+, Bun, Deno and edge runtimes
- Handles the async flow for you: `enrichPersonAndWait` polls until the result is ready
- Webhook signature verification included

```bash
npm install @listar-app/sdk
```

## Quick start

Create an API key in [Settings › API keys](https://listar.fr/en/settings/api-keys).

```ts
import { Listar } from '@listar-app/sdk';

const listar = new Listar({ apiKey: process.env.LISTAR_API_KEY! });

const outcome = await listar.enrichPersonAndWait({
  firstName: 'Jane',
  lastName: 'Doe',
  company: 'Acme',
});

if (outcome.status === 'completed') {
  console.log(outcome.result);
}
```

Billed per data point found, from your Listar credit. Nothing is billed when nothing is found.

## Person enrichment

An enrichment is not always instant: Listar may keep retrieving data in the background. `enrichPerson` returns one of three outcomes:

| `status`           | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `completed`        | The result is in `result`                                       |
| `pending`          | Still running: poll `getResult(id)` or use a webhook            |
| `payment_required` | Ready, but the credit is too low: top up or `payWithCredit(id)` |

```ts
// Identify the person as precisely as possible: a LinkedIn slug is best.
const outcome = await listar.enrichPerson({ linkedinSlug: 'jane-doe-123' });

if (outcome.status === 'pending') {
  const final = await listar.waitForResult(outcome.id, { timeoutMs: 120_000 });
}

// Phone only, from an email
await listar.enrichPersonAndWait({
  email: 'jane@acme.com',
  enrichmentType: 'phone',
});
```

To avoid polling, pass a `callbackUrl`: Listar posts the `enrichment.completed` event when the result is ready (see [Webhooks](#webhooks)).

### Bulk

Up to 10,000 contacts per call. The full result is pushed once to your `callbackUrl`.

```ts
const batch = await listar.bulkEnrich({
  contacts: [
    { ref: 'crm-1', firstName: 'Jane', lastName: 'Doe', company: 'Acme' },
    { ref: 'crm-2', linkedinSlug: 'john-smith-42' },
  ],
  options: { searchPhone: true, searchProEmail: true },
  callbackUrl: 'https://example.com/webhooks/listar',
});
```

## Companies

```ts
// Decision makers of one company. The domain or the SIRET beats a bare name.
const company = await listar.findCompanyContactsAndWait({
  domain: 'acme.com',
  withContacts: true,
  hintTitles: 'CEO, Head of Sales',
});

// A list of companies from a plain-language brief, billed per company delivered.
const list = await listar.searchCompaniesAndWait({
  brief: 'SaaS publishers in Lyon selling to HR teams, 10 to 100 employees',
  target: 25,
});
```

## Verification

```ts
await listar.verifyEmails(['jane@acme.com', 'john@acme.com']);
await listar.verifyPhoneOwnership({
  contacts: [{ phone: '+33612345678', firstName: 'Jane', lastName: 'Doe' }],
});
```

## Account

```ts
const { balanceFormatted } = await listar.getCreditBalance();
const csv = await listar.exportSearchesCsv({ from: '2026-10-01' });
```

## Webhooks

Every webhook carries an `X-Listar-Signature` header. Verify it against your signing secret (Settings › API keys), on the raw body:

```ts
import { parseWebhookEvent } from '@listar-app/sdk/webhooks';

// Express: app.post('/webhooks/listar', express.text({ type: '*/*' }), handler)
const event = await parseWebhookEvent(
  req.body,
  req.headers['x-listar-signature'],
  process.env.LISTAR_WEBHOOK_SECRET!,
);

if (event.event === 'enrichment.completed') {
  // event.result
}
```

The same event can arrive more than once: deduplicate on its `id` and `status`.

## Errors

Any other answer throws a `ListarError` with `status`, `body` and, on a 429, `retryAfter` (seconds) when the API sends it. Network failures and timeouts (120 s by default, `timeoutMs` to change it) throw a `ListarError` with `status` 0.

```ts
import { ListarError } from '@listar-app/sdk';

try {
  await listar.getCreditBalance();
} catch (error) {
  if (error instanceof ListarError && error.status === 401) {
    // invalid or revoked key
  }
}
```

## Links

- API reference: https://api.listar.fr/docs
- Pricing: https://listar.fr/en/pricing
- MCP server for Claude and ChatGPT: https://listar.fr/en/mcp
- n8n node: [n8n-nodes-listar](https://www.npmjs.com/package/n8n-nodes-listar)

## License

MIT
