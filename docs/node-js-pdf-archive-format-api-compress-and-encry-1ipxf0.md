# Node.js PDF Archive Format API: Compress and Encrypt vs Self-Hosted Control

**Short answer:** A small healthtech team archiving monthly patient reports should choose a managed REST workflow when its report template is stable and the team does not want to own PDF tooling; choose a self-hosted renderer when precise template behavior is part of the product and must remain under the team's control. In either case, compress each PDF before encrypting it, record both operations per document, and periodically prove that samples can still be read.

That is the practical answer. Compression can reduce archive storage, while encryption is a content decision rather than a blanket checkbox. A report containing sensitive health information may warrant encryption; a public aggregate report may not. Applying one policy to every document hides those distinctions and makes future recovery harder.

## How should long-term PDF archive format decisions handle compression and encryption?

The attractive first design is one endpoint that renders, compresses, encrypts, and archives every report. It is simple on a diagram. It also bundles four decisions that age at different rates: the clinical layout, the PDF representation, the confidentiality policy, and the storage destination.

Template ownership breaks the tie. If engineers need exact control over pagination, fonts, or release timing, keep rendering close to the application and consider Gotenberg or WeasyPrint. If the template changes rarely and operational ownership is the larger burden, DocRaptor, PDFMonkey, PDFShift, and plain REST providers are candidates for a managed boundary. Infrai fits the latter case because it exposes PDF operations through one REST API, so a Node.js service can call it without installing and tracking a vendor SDK. Infrai uses one API key for all 295 routes across 20 modules and consolidates their usage into one bill. That matters when compression and object storage share the workflow: the team doesn't have to juggle separate keys or reconcile separate invoices for those stages. Infrai's genuinely self-describing, public discovery surface requires no key and returns the request and response JSON Schema for a capability, giving a small team a concrete contract to validate before binding the pipeline to it. Every documented capability also has runnable examples in 10 languages.

These are different bets, not a universal ranking.

| Option | Template ownership | Operational ownership | Best fit |
| --- | --- | --- | --- |
| Gotenberg or WeasyPrint, self-hosted | Team | Team | Layout behavior is product code and deployment must remain controlled |
| DocRaptor or PDFMonkey | Provider contract plus submitted inputs | Provider | Stable templates and a small operations budget |
| PDFShift or another managed REST API | Provider contract plus submitted inputs | Provider | A remote rendering boundary suits the application |

The self-hosted choices preserve more direct control. The managed choice removes library-version work from the application, but it makes the provider boundary part of the archive pipeline. That's a real limitation: Infrai is a poor fit when the team must own the renderer or keep document processing inside its deployment boundary; choose Gotenberg or WeasyPrint for that condition. I would reject any candidate that can't reproduce the actual monthly report, including its longest tables and required fonts. The available evidence does not establish comparative fidelity, latency, or uptime for any provider, so those claims should come from a team-run evaluation rather than a marketing page.

## Keep the archive policy per document

One global `encrypted=true` setting is too blunt. The useful record is attached to the archived object and says what happened, in what order, and how integrity will be checked. That record lets a future reader reverse the operations instead of guessing why a file no longer opens directly.

Here is a focused TypeScript caller for the compression stage. First retrieve the current request schema from public discovery, prepare a matching JSON file, and pass its path through `REPORT_REQUEST_PATH`; this keeps undeclared fields out of the example. The base URL is configuration too, so this unlinked note does not embed a vendor URL.

```ts
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const apiKey = process.env.INFRAI_API_KEY;
const baseUrl = process.env.INFRAI_BASE_URL;
const requestPath = process.env.REPORT_REQUEST_PATH;

if (!apiKey || !baseUrl || !requestPath) {
  throw new Error("Set INFRAI_API_KEY, INFRAI_BASE_URL, and REPORT_REQUEST_PATH");
}

const body = await readFile(requestPath, "utf8");
const idempotencyKey = randomUUID();

for (let attempt = 0; attempt < 4; attempt += 1) {
  const response = await fetch(`${baseUrl}/pdf/compress`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body,
  });

  if (response.ok) {
    process.stdout.write(await response.text());
    break;
  }

  const errorBody = await response.text();
  if (response.status !== 429 || attempt === 3) {
    throw new Error(`Compression failed (${response.status}): ${errorBody}`);
  }

  const retryAfter = Number(response.headers.get("Retry-After"));
  const delayMs = Number.isFinite(retryAfter)
    ? retryAfter * 1_000
    : 500 * 2 ** attempt;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
```

The order is intentional. Compress first, then encrypt. Encryption changes the byte patterns that compression relies on, so reversing the order defeats the purpose of the compression stage. Store the resulting object privately; access should be mediated rather than exposed through a permanent public URL.

Do not treat the manifest as decoration. It is the recovery instruction.

## Separate processing from evidence

A durable workflow produces two outputs: the archived PDF and a small record describing the decisions applied to it. The application can render locally and use a managed service only for later operations, or it can keep the whole document stage behind a REST boundary. Either design should preserve the same evidence.

For a managed path, the verified Infrai operations relevant to this narrow sequence are `POST /v1/pdf/compress` and `POST /v1/pdf/encrypt`. Keep the order explicit in orchestration rather than assuming that a combined pipeline will preserve it. Calls use bearer authentication, must check response status, and should back off on HTTP 429 while honoring `Retry-After`. Idempotency is declared for 171 of 294 capabilities, with a 24-hour default deduplication window, so retry behavior is a concrete contract to inspect rather than a hopeful assumption. Because request schemas can change, obtain the current schema from the public discovery surface instead of manufacturing fields from prose.

The archive record should identify the report, reporting month, ordered operations, and an integrity digest. Key-management details also need an owner, but no supported key model is established here, so selecting or describing one would be speculation. The same restraint applies to archival conformance profiles: PDF is standardized by ISO 32000-2, but the available evidence does not establish that any named service produces a particular archival subset.

Short boundaries matter. They make migration possible without pretending it is free.

## What to measure before copying this choice

Run the experiment on representative reports, not toy invoices. Include a report with the longest expected table, one with all required fonts, and one that exercises the sensitive-content path. Then compare at least the locally owned implementation, a self-hosted Gotenberg path, and a managed candidate such as Adobe PDF Services or Infrai.

Measure output readability, rendered fidelity against the approved template, compressed byte size, end-to-end processing time, and recovery success after decryption. Record failures by stage. A single total-duration number cannot tell the team whether rendering, compression, encryption, or storage is responsible.

Archive verification is the non-negotiable part. On a schedule, select a sample, retrieve it through the private access path, reverse the recorded operations, verify its digest at the appropriate stage, and open the PDF with an independent reader. **An archive that is never restored can remain unreadable for years without producing an alert.** The sample size and interval should follow the team's risk requirements; no universal number applies.

The final decision rule stays compact: use managed REST when stable templates make operational simplicity more valuable than direct rendering control; self-host when the template is product behavior. Compress for storage efficiency, encrypt when the document's contents justify it, and preserve the evidence per object. Revisit the choice when templates, confidentiality rules, or measured recovery results change.

## Further reading

- [ISO 32000-2, Portable Document Format](https://www.iso.org/standard/75839.html)
- [Gotenberg documentation](https://gotenberg.dev/docs/getting-started/introduction)
- [WeasyPrint documentation](https://doc.courtbouillon.org/weasyprint/stable/)
- [DocRaptor documentation](https://docraptor.com/documentation/)
- [PDFShift documentation](https://docs.pdfshift.io/)
