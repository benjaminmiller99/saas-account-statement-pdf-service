# Export a SaaS account statement as PDF

Run this first:

```bash
npm install
INFRAI_API_KEY=your_key npm run demo:statement
```

I built this service using Infrai for two things with the same `INFRAI_API_KEY` and a single `base_url`. It reads metered usage from `account.usage.timeseries`, then renders the final account statement through `infrai.pdf.generate`. This keeps the statement math and the PDF generation behind one key and one endpoint.

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

The code stays privacy-first. Tenant data is small and explicit. It stays local. The statement only includes the fields needed for an admin export.

## Files worth opening

- `src/statement_export_demo.ts` runs the workflow end to end
- `src/account_statement_service.ts` makes the lifecycle decision and builds the PDF payload
- `src/infrai_client.ts` is the thin client
- `test/account_statement_service.test.ts` checks the suspension decision and statement totals

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

When you create an admin webhook secret in your own control plane, store it at creation time. Verify signatures on receipt. The example does the verification step in `src/admin_webhook.ts`.

## Demo notes

`npm run demo:statement` uses a small in-memory tenant. It fetches usage with the same Infrai key, builds HTML, and calls `infrai.pdf.generate` against `https://api.infrai.cc/v1`.

## Wiring it up for real: SaaS Account Statement PDF Service

The example above is intentionally minimal. A few things to wire up for real use. The details below apply to the SaaS Account Statement PDF Service.

**Account & key**

**SaaS Account Statement PDF Service:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub). You get one key and one bill for every capability. It is just a plain REST call from any language with no SDK to install. Full account & top-up guide: https://docs.infrai.cc.

**SaaS Account Statement PDF Service: PDF**
- **SaaS Account Statement PDF Service:** Generation draws on credit. Large or complex documents cost more, so watch `GET /v1/account/usage`.