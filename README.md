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

Every person result carries `linkedinProfile` (URL, current job title and company), free with a phone or email search. To get it alone, without any phone or email search (billed only when it tells something new):

```ts
const qualified = await listar.enrichPersonAndWait({
  linkedinSlug: 'jane-doe-123',
  enrichmentType: 'none',
});
// qualified.result.linkedinProfile → { url, jobTitle, company, observedAt, billable }
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
  // each result also carries linkedinUrl, jobTitle and company, for free
  options: { searchPhone: true, searchProEmail: true },
  callbackUrl: 'https://example.com/webhooks/listar',
});
```

### Wrong data

A phone that is someone else's, an email that bounces: report it with the result `id` (a person search, or a bulk row). For a year, those values are never delivered nor billed to you again for that person, so searching again returns another number if one exists, and bills only that new one. A later `positive` rating of the same result lifts the exclusion.

```ts
const outcome = await listar.enrichPersonAndWait({
  linkedinSlug: 'jane-doe-123',
});
if (outcome.status === 'completed' && outcome.id) {
  await listar.reportResult({
    id: outcome.id, // or the `id` of a bulk row
    rating: 'negative',
    reasons: ['wrong_phone'],
    phones: ['+33646354759'],
  });
  const again = await listar.enrichPersonAndWait({
    linkedinSlug: 'jane-doe-123',
  });
}
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

## People by role

```ts
// Who holds a role, without knowing their company. Here: the heads of sales
// who took their job in France over the last 2 months. Billed per person
// delivered; they come without phone or email, saved in a list to enrich.
const found = await listar.searchPeopleAndWait({
  brief: 'Heads of sales who took their job in France over the last 2 months',
  criteria: {
    titles: [
      'head of sales',
      'sales director',
      'directeur commercial',
      'directrice commerciale',
      'chief revenue officer',
    ],
    countries: ['France'],
    startedWithinDays: 60,
  },
  target: 100,
});
console.log(found.delivered, found.listId);
```

A wait that fails after the launch (timed out, credit short at settlement) throws a `ListarError` carrying `searchId`: the search may still complete and be billed, so collect it with `getPeopleSearch(error.searchId)` instead of launching it again.

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
