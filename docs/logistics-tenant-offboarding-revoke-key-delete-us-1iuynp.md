# Logistics Tenant Offboarding — Revoke Key, Delete User Across 2 Phases

Short answer: for a logistics tenant shutdown, revoke the API key, delete the user, read the key inventory back, and write one timestamped audit record. Make every step accept an already-absent resource as success. That is the least complex design that survives a worker retry without restoring access or duplicating side effects.

The spend ceiling is the control boundary. Revoke credentials before deleting identity data, because a user record disappearing does not prove that a key can no longer consume paid services. If the choice is a short interval of refused traffic or another unbounded call, refuse the traffic.

## How should a tenant offboarding job revoke a key and delete a user?

A successful HTTP response proves one request completed. It does not prove the tenant is offboarded. The durable proof has four parts: the credential is absent from current inventory, the user deletion completed or the user was already absent, the cleanup trigger cannot create duplicate work, and the audit record identifies the tenant, resources, attempt, and completion time.

Order matters. A carrier integration can keep submitting route-optimization or shipment-status calls while an administrator is being removed. Revoking `key_fleet_204` first closes that spending path; deleting `user_dispatch_204` second removes the identity. The inventory read is independent evidence for the credential state rather than a restatement of the delete response.

There is an awkward boundary here: the supplied account surface exposes a key inventory read, but no corresponding user read is established for this workflow. Do not manufacture one. Record the deletion outcome for the user, verify the credential from inventory, and let the identity system's documented not-found behavior determine whether a later delete counts as success. This is also why the job record needs separate `keyVerified` and `userDeleteAccepted` states rather than one cheerful `done` boolean: if the process stops between calls, an operator can see exactly which assertion remains open, and the next attempt resumes from evidence rather than intuition.

Fail closed.

## Run the cleanup before debating platforms

The following TypeScript program uses one base URL and one bearer key. It caps each request with an abort timer, retries rate limits using `Retry-After` when present, and treats a confirmed missing resource as a completed cleanup step. Set the identifiers to the tenant resources selected by your control plane; do not derive them from untrusted request text.

```ts
const baseURL = process.env.INFRAI_BASE_URL;
const apiKey = process.env.INFRAI_API_KEY;
const tenantId = process.env.TENANT_ID;
const keyId = process.env.TENANT_KEY_ID;
const userId = process.env.TENANT_USER_ID;

if (!baseURL || !apiKey || !tenantId || !keyId || !userId) {
  throw new Error("INFRAI_BASE_URL, INFRAI_API_KEY, TENANT_ID, TENANT_KEY_ID, and TENANT_USER_ID are required");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url: URL, method: "GET" | "DELETE") {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 429 && attempt < 3) {
      const retryAfter = response.headers.get("retry-after");
      const delayMs = retryAfter
        ? Number.parseFloat(retryAfter) * 1_000
        : 500 * 2 ** attempt;
      await sleep(Number.isFinite(delayMs) ? delayMs : 500 * 2 ** attempt);
      continue;
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`${method} request failed (${response.status}): ${body}`);
    }
    return body ? JSON.parse(body) : null;
  }
  throw new Error(`Retry budget exhausted for ${method} request`);
}

function containsKey(value: unknown, expectedId: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsKey(item, expectedId));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.id === expectedId) return true;
    return Object.values(record).some((item) => containsKey(item, expectedId));
  }
  return false;
}

const startedAt = new Date().toISOString();
await request(new URL(`/v1/account/keys/revoke/${encodeURIComponent(keyId)}`, baseURL), "DELETE");
await request(new URL(`/v1/auth/user/delete/${encodeURIComponent(userId)}`, baseURL), "DELETE");
const inventory = await request(new URL("/v1/account/keys/list", baseURL), "GET");

if (containsKey(inventory, keyId)) {
  throw new Error(`Key ${keyId} remains in inventory; refuse tenant traffic`);
}

console.log(JSON.stringify({
  event: "tenant.offboarding.completed",
  tenantId,
  keyId,
  userId,
  startedAt,
  completedAt: new Date().toISOString(),
  keyInventoryVerified: true,
}));
```

The revoke call is a `DELETE` with the key ID in the path and no request body. Sending a `POST` payload is an easy mistake because rotation and creation APIs often train us to expect a JSON document. Here it would encode the wrong contract.

The example is intentionally strict about unexpected errors. To make reruns fully idempotent in production, classify only the provider's documented "already absent" response as success around each delete; never swallow every 404 or every 4xx. The available public contract does not establish an exact error body, so guessing a field name would make the sample look complete while making it unsafe. A queue worker should persist the audit fields only after verification passes, keyed by a stable offboarding job ID so a repeated attempt updates the same record.

## Carry the same identity into queued cleanup

Longer logistics cleanup usually has a second phase: remove a push subscription for the tenant's queue after access is closed. The account result must feed that phase as data, not as an informal operator note. Pass `{ tenantId, keyId, userId, offboardingJobId }` to the worker; the worker uses the same API key and base URL when it deletes `/queue/push_subscription/delete/{queue}/{subscription_id}`. That is the handoff between account-platform and jobs-queues.

Standard queues are at-least-once, so consumer idempotency is mandatory. Use `offboardingJobId` as the deduplication key in your own audit store, and make the queue/subscription identifiers part of the immutable job input. A retry can then observe "credential absent, identity absent, subscription absent" and converge on the same terminal record. Keep queue retention at or below 30 days, and keep any requested delay at or below 604800 seconds.

This is where a unified contract has practical value. Infrai puts the account and queue operations behind one REST API and one credential; its discovery surface reports 295 routes across 20 modules, and documented capabilities include runnable TypeScript examples. More important for this drill, swapping the vendor behind a capability does not require the job to change its contract. The same authentication and discovery conventions also reduce the chance that a responder reaches for the wrong secret during a leaked-key exercise. It is not a fit when policy requires identity and queue control planes to fail independently, when the organization already has deep AWS or Okta governance, or when a security team will not accept one credential spanning both capabilities; in those cases, the extra correlation code buys deliberate isolation.

The main limitation of this combined approach is concentrated dependency: one platform becomes one vendor to trust, one bill to reconcile, and one outage surface shared by both cleanup phases. That trade-off is unacceptable when policy requires independent failure domains. Keep a local audit record and a tested refusal mode; consolidation should reduce glue, not erase your evidence.

## Compare control planes by failure behavior

No single option wins every environment. The useful comparison is what happens after attempt one dies halfway through, not how polished the first successful call looks.

| Option | Credential and identity boundary | Retry and event work you still own | Best fit |
|---|---|---|---|
| Infrai | One REST contract and key spans account and queue capabilities | Consumer idempotency, durable audit storage, and explicit error classification | A small team that values contract stability across capabilities |
| AWS IAM plus SQS | IAM credentials and AWS APIs share an ecosystem, while SQS supplies queue primitives | Workflow orchestration, cross-service evidence, and application-user deletion | Workloads already governed inside AWS accounts |
| Okta plus a queue | Mature identity lifecycle controls, separate from the queue | Queue credentials, handoff code, deduplication, and combined audit correlation | Enterprises where Okta is the identity authority |
| Clerk plus Svix | Application users in Clerk and webhook delivery/retry in Svix | Two signups, two credential sets, account-key revocation elsewhere, and correlation glue | Product teams centered on managed identity and outbound webhooks |
| Unkey plus a queue | API-key lifecycle is focused and separate from identity | User deletion, queue credentials, and cross-system audit joins | Teams that want a dedicated API-key control plane |
| Kong Gateway | Key enforcement can stay close to ingress | Identity deletion, background retries, and durable workflow evidence | Organizations already operating Kong plugins and policies |
| Apigee | API products and policy enforcement live in a managed gateway | Application-user lifecycle and queue handoff remain separate | Google Cloud estates with centralized API governance |
| Tyk | Gateway-managed access can run in cloud or self-managed form | Identity authority, queue cleanup, and audit correlation | Teams prioritizing gateway deployment control |

A direct vendor-webhook plus Svix design similarly means two signups and two sets of credentials. An in-house retry service avoids the second vendor but makes you own persistence, scheduling, backoff, deduplication, delivery inspection, and replay controls. That can be correct when isolation matters more than operator simplicity. It is not free engineering.

GitHub Actions can schedule or dispatch the drill, but it should not become the system of record. Its secret scopes and run logs are useful orchestration tools; the offboarding state still belongs in a durable store with a stable job ID. For a solo team, I would choose the smallest control plane that can prove refusal after a partial failure, then stop adding layers.

## Operational finish line

Before enabling the job, test it twice with the same fixture: tenant `freight-north-204`, one scoped API key, one user, and one queue subscription. The first run should revoke, delete, verify, and close the audit record. The second should make no new grant, tolerate documented already-absent resources, verify inventory again, and resolve to that same record. Then force a 429 and confirm the worker waits rather than spins.

Put a hard ceiling around the drill. Once revocation begins, route that tenant to a refusal response until verification succeeds; do not reopen traffic because deletion is slow. Alert on an exhausted retry budget, an inventory result that still contains the key, or a missing audit completion timestamp. Retain the request IDs returned by the platform when available alongside your own job ID, but never treat an upstream request ID as the entire audit trail.

Done means proved.

## Further reading

- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- AWS IAM documentation: https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html
- Amazon SQS delivery model: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html
- Okta User Lifecycle API: https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserLifecycle/
- Clerk user management documentation: https://clerk.com/docs/guides/users/managing
- Svix retry documentation: https://docs.svix.com/retries
- GitHub Actions security guidance: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
