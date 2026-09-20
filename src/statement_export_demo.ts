import { exportAccountStatement } from './account_statement_service';
import { onboardTenant } from './tenant_onboarding';
import { parseAdminOperations, signWebhookPayload, verifyWebhookSignature } from './admin_webhook';
import { lifecycleBatchSchema } from './account_lifecycle';

async function main(): Promise<void> {
  const tenant = onboardTenant({
    tenantId: 'tenant_clinic_204',
    legalName: 'Northline Clinic Group',
    adminEmail: 'ops@northline.example',
    planName: 'care-ops',
    startedAt: '2025-01-01T00:00:00.000Z',
    trialEndsAt: '2025-01-14T00:00:00.000Z',
    unitPriceUsd: 0.4,
    baseFeeUsd: 18
  });

  const lifecycleEvents = lifecycleBatchSchema.parse([
    { type: 'trial_started', occurredAt: '2025-01-01T00:00:00.000Z' },
    { type: 'activated', occurredAt: '2025-01-15T00:00:00.000Z' },
    {
      type: 'payment_received',
      occurredAt: '2025-02-01T00:00:00.000Z',
      invoiceId: 'inv_1001',
      amountUsd: 42
    }
  ]);

  const admin = parseAdminOperations({
    budget: {
      hardCapUsd: 500,
      period: 'monthly',
      alertThresholdUsd: 350
    },
    webhook: {
      url: 'https://billing.example/webhooks/statement-events',
      events: ['statement.exported'],
      secret: 'local-demo-secret'
    }
  });

  const webhookPayload = JSON.stringify({ event: 'statement.exported', tenantId: tenant.tenantId });
  const signature = signWebhookPayload(webhookPayload, admin.webhook.secret);
  if (!verifyWebhookSignature(webhookPayload, signature, admin.webhook.secret)) {
    throw new Error('Webhook signature check failed');
  }

  const result = await exportAccountStatement({
    tenant,
    lifecycleEvents,
    admin,
    statementStart: '2025-02-01T00:00:00.000Z',
    statementEnd: '2025-02-28T23:59:59.000Z',
    asOf: '2025-02-28T23:59:59.000Z',
    usageQuery: {
      start_time: '2025-02-01T00:00:00.000Z',
      end_time: '2025-02-28T23:59:59.000Z',
      granularity: 'day'
    }
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
