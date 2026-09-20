import { describe, expect, it } from 'vitest';
import { buildStatementSummary } from '../src/account_statement_service';

describe('buildStatementSummary', () => {
  it('marks an account suspended after a 30-day overdue invoice and totals metered usage', () => {
    const summary = buildStatementSummary({
      tenant: {
        tenantId: 'tenant_clinic_204',
        legalName: 'Northline Clinic Group',
        adminEmail: 'ops@northline.example',
        planName: 'care-ops',
        startedAt: '2025-01-01T00:00:00.000Z',
        trialEndsAt: '2025-01-14T00:00:00.000Z',
        unitPriceUsd: 0.4,
        baseFeeUsd: 18
      },
      lifecycleEvents: [
        { type: 'trial_started', occurredAt: '2025-01-01T00:00:00.000Z' },
        { type: 'activated', occurredAt: '2025-01-15T00:00:00.000Z' },
        {
          type: 'invoice_overdue',
          occurredAt: '2025-01-20T00:00:00.000Z',
          invoiceId: 'inv_1002',
          amountUsd: 80
        }
      ],
      statementStart: '2025-02-01T00:00:00.000Z',
      statementEnd: '2025-02-28T23:59:59.000Z',
      asOf: '2025-02-25T00:00:01.000Z',
      usagePoints: [
        { timestamp: '2025-02-05T00:00:00.000Z', value: 120 },
        { timestamp: '2025-02-20T00:00:00.000Z', value: 80 }
      ]
    });

    expect(summary.status).toBe('suspended');
    expect(summary.totalUnits).toBe(200);
    expect(summary.totalDueUsd).toBe(98);
  });
});
