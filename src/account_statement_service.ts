import { z } from 'zod';
import { infrai } from './infrai_client';
import { decideAccountStatus, lifecycleBatchSchema, type AccountStatus, type LifecycleEvent } from './account_lifecycle';
import { tenantOnboardingSchema, type TenantOnboarding } from './tenant_onboarding';
import { adminOperationsSchema, type AdminOperations } from './admin_webhook';

const statementRequestSchema = z.object({
  tenant: tenantOnboardingSchema,
  lifecycleEvents: lifecycleBatchSchema,
  admin: adminOperationsSchema,
  statementStart: z.string().datetime(),
  statementEnd: z.string().datetime(),
  asOf: z.string().datetime(),
  usageQuery: z.record(z.string())
});

export type StatementRequest = z.infer<typeof statementRequestSchema>;

export type UsageLine = {
  label: string;
  units: number;
  unitPriceUsd: number;
  amountUsd: number;
};

export type StatementSummary = {
  tenantId: string;
  legalName: string;
  status: AccountStatus;
  statementStart: string;
  statementEnd: string;
  baseFeeUsd: number;
  totalUnits: number;
  usageAmountUsd: number;
  totalDueUsd: number;
  usageLines: UsageLine[];
};

function normalizeTimeseries(response: unknown): Array<{ timestamp: string; value: number }> {
  if (Array.isArray(response)) {
    return response
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          timestamp: String(row.timestamp),
          value: Number(row.value)
        };
      })
      .filter((item) => Number.isFinite(item.value));
  }

  if (response && typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    if (Array.isArray(obj.points)) {
      return obj.points
        .map((item) => {
          const row = item as Record<string, unknown>;
          return {
            timestamp: String(row.timestamp),
            value: Number(row.value)
          };
        })
        .filter((item) => Number.isFinite(item.value));
    }
  }

  return [];
}

export function buildStatementSummary(input: {
  tenant: TenantOnboarding;
  lifecycleEvents: LifecycleEvent[];
  statementStart: string;
  statementEnd: string;
  asOf: string;
  usagePoints: Array<{ timestamp: string; value: number }>;
}): StatementSummary {
  const status = decideAccountStatus(input.lifecycleEvents, input.asOf);
  const totalUnits = input.usagePoints.reduce((sum, point) => sum + point.value, 0);
  const usageAmountUsd = Number((totalUnits * input.tenant.unitPriceUsd).toFixed(2));
  const totalDueUsd = Number((input.tenant.baseFeeUsd + usageAmountUsd).toFixed(2));

  return {
    tenantId: input.tenant.tenantId,
    legalName: input.tenant.legalName,
    status,
    statementStart: input.statementStart,
    statementEnd: input.statementEnd,
    baseFeeUsd: input.tenant.baseFeeUsd,
    totalUnits,
    usageAmountUsd,
    totalDueUsd,
    usageLines: [
      {
        label: 'Metered platform usage',
        units: totalUnits,
        unitPriceUsd: input.tenant.unitPriceUsd,
        amountUsd: usageAmountUsd
      }
    ]
  };
}

export function renderStatementHtml(summary: StatementSummary, admin: AdminOperations): string {
  const usageRows = summary.usageLines
    .map(
      (line) => `<tr><td>${line.label}</td><td>${line.units}</td><td>$${line.unitPriceUsd.toFixed(2)}</td><td>$${line.amountUsd.toFixed(2)}</td></tr>`
    )
    .join('');

  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #1f2937; }
        h1, h2 { margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
        .meta { margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <h1>Account statement</h1>
      <div class="meta">
        <div>Tenant: ${summary.legalName}</div>
        <div>Tenant ID: ${summary.tenantId}</div>
        <div>Status at export: ${summary.status}</div>
        <div>Statement window: ${summary.statementStart} to ${summary.statementEnd}</div>
      </div>
      <h2>Charges</h2>
      <table>
        <thead>
          <tr><th>Line item</th><th>Units</th><th>Unit price</th><th>Amount</th></tr>
        </thead>
        <tbody>
          ${usageRows}
          <tr><td>Base fee</td><td>1</td><td>$${summary.baseFeeUsd.toFixed(2)}</td><td>$${summary.baseFeeUsd.toFixed(2)}</td></tr>
        </tbody>
      </table>
      <h2>Total due</h2>
      <div>$${summary.totalDueUsd.toFixed(2)}</div>
      <h2>Admin controls in effect</h2>
      <div>Budget period: ${admin.budget.period}</div>
      <div>Budget alert threshold: $${admin.budget.alertThresholdUsd.toFixed(2)}</div>
      <div>Webhook destination: ${admin.webhook.url}</div>
    </body>
  </html>`;
}

export async function exportAccountStatement(input: unknown): Promise<{
  summary: StatementSummary;
  pdfResult: unknown;
}> {
  const parsed = statementRequestSchema.parse(input);
  const usageResponse = await infrai.account.usage.timeseries(parsed.usageQuery);
  const usagePoints = normalizeTimeseries(usageResponse);
  const summary = buildStatementSummary({
    tenant: parsed.tenant,
    lifecycleEvents: parsed.lifecycleEvents,
    statementStart: parsed.statementStart,
    statementEnd: parsed.statementEnd,
    asOf: parsed.asOf,
    usagePoints
  });
  const html = renderStatementHtml(summary, parsed.admin);
  const pdfResult = await infrai.pdf.generate({
    html,
    page_size: 'A4',
    orientation: 'portrait',
    store: true
  });

  return { summary, pdfResult };
}
