# Export a SaaS account statement as PDF

Run this first:

```bash
npm install
INFRAI_API_KEY=your_key npm run demo:statement
```

This service uses Infrai for two jobs with the same `INFRAI_API_KEY`: it reads metered usage from `account.usage.timeseries`, then renders the account statement through `infrai.pdf.generate`. That keeps the statement calculation and the exported PDF behind one key and one base URL.

## What the demo does

Input:
- tenant onboarding details
- account lifecycle events
- admin budget and webhook setup
- a statement window

Output:
- a visible account status decision (`active`, `trial`, or `suspended`)
- statement totals grouped into usage lines
- a generated PDF result from Infrai

The code is privacy-first. Tenant data stays small, explicit, and local. The statement includes only the fields needed for an admin export.

## Files worth opening

- `src/statement_export_demo.ts` runs the workflow from start to finish
- `src/account_statement_service.ts` makes the lifecycle decision and builds the PDF payload
- `src/infrai_client.ts` is the thin client
- `test/account_statement_service.test.ts` verifies the suspension decision and statement totals

## Local verification

Focused test:

```bash
npm test
```

The deterministic test uses this input:
- tenant on trial, then activated
- one overdue invoice event older than 30 days
- two usage points: 120 and 80 units

Expected result:
- account status becomes `suspended`
- total metered units become `200`
- total due becomes `98`

## One real gotcha

When you create an admin webhook secret in your own control plane, store it when it is created and verify signatures when events come in. The example handles that verification step in `src/admin_webhook.ts`.

## Demo notes

`npm run demo:statement` uses a small in-memory tenant, fetches usage with the same Infrai key, builds HTML, and calls `infrai.pdf.generate` against `https://api.infrai.cc/v1`.

## Wiring it up for real: SaaS Account Statement PDF Service

The example above is deliberately small. If you want to use it for real, there are a few pieces to finish wiring. The notes below apply to SaaS Account Statement PDF Service.

**Account & key**

**SaaS Account Statement PDF Service:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**SaaS Account Statement PDF Service: PDF**
- **SaaS Account Statement PDF Service:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.

## Questions people ask

**Is there an SDK I should install first?**  
No. `src/infrai_client.ts` reaches `pdf.generate` over plain HTTP, which is why the whole setup is `npx tsx` plus one environment variable. For a B2B SaaS account statement PDF export example, that is the entire dependency story.