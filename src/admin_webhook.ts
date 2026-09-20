import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const adminOperationsSchema = z.object({
  budget: z.object({
    hardCapUsd: z.number().positive(),
    period: z.enum(['monthly', 'annual']),
    alertThresholdUsd: z.number().positive()
  }),
  webhook: z.object({
    url: z.string().url(),
    events: z.array(z.string().min(1)).min(1),
    secret: z.string().min(8)
  })
});

export type AdminOperations = z.infer<typeof adminOperationsSchema>;

export function parseAdminOperations(input: unknown): AdminOperations {
  return adminOperationsSchema.parse(input);
}

export function signWebhookPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = signWebhookPayload(payload, secret);
  return timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
}
