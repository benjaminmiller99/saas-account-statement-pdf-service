import { z } from 'zod';

export const lifecycleEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('trial_started'),
    occurredAt: z.string().datetime()
  }),
  z.object({
    type: z.literal('activated'),
    occurredAt: z.string().datetime()
  }),
  z.object({
    type: z.literal('invoice_overdue'),
    occurredAt: z.string().datetime(),
    invoiceId: z.string().min(1),
    amountUsd: z.number().nonnegative()
  }),
  z.object({
    type: z.literal('payment_received'),
    occurredAt: z.string().datetime(),
    invoiceId: z.string().min(1),
    amountUsd: z.number().nonnegative()
  })
]);

export const lifecycleBatchSchema = z.array(lifecycleEventSchema);

export type LifecycleEvent = z.infer<typeof lifecycleEventSchema>;
export type AccountStatus = 'trial' | 'active' | 'suspended';

export function decideAccountStatus(events: LifecycleEvent[], asOfIso: string): AccountStatus {
  const asOf = new Date(asOfIso).getTime();
  const hasActivation = events.some((event) => event.type === 'activated');
  const overdueOlderThan30Days = events.some((event) => {
    if (event.type !== 'invoice_overdue') {
      return false;
    }
    const ageMs = asOf - new Date(event.occurredAt).getTime();
    return ageMs > 30 * 24 * 60 * 60 * 1000;
  });

  if (overdueOlderThan30Days) {
    return 'suspended';
  }
  if (hasActivation) {
    return 'active';
  }
  return 'trial';
}
