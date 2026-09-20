import { z } from 'zod';

export const tenantOnboardingSchema = z.object({
  tenantId: z.string().min(1),
  legalName: z.string().min(1),
  adminEmail: z.string().email(),
  planName: z.string().min(1),
  startedAt: z.string().datetime(),
  trialEndsAt: z.string().datetime(),
  unitPriceUsd: z.number().nonnegative(),
  baseFeeUsd: z.number().nonnegative()
});

export type TenantOnboarding = z.infer<typeof tenantOnboardingSchema>;

export function onboardTenant(input: unknown): TenantOnboarding {
  return tenantOnboardingSchema.parse(input);
}
