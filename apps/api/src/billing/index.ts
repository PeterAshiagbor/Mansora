import { billingEnvFromEnv, NoEmail, type Billing, type BillingEnv, type EmailAdapter } from './core';
import type { Database } from '../db';
import { createProviders, ProviderRegistry } from './providers/registry';
import type { SandboxProvider } from './providers/sandbox';
import { resendFromEnv } from '../email';

export * from './core';
export { registerBillingRoutes } from './routes';
export { runDaily, runBillingCycle, runReminders, runReconciliation } from './jobs';

/** Billing wired from the environment. The sandbox provider is only ever created outside production, or when explicitly allowed. */
export function createBillingFromEnv(db: Database): { billing: Billing; sandbox?: SandboxProvider } {
  const production = process.env.NODE_ENV === 'production';
  const env = billingEnvFromEnv(production);
  const allowSandbox = !production || process.env.BILLING_ALLOW_SANDBOX === '1';
  const { registry, sandbox } = createProviders({ paystackSecretKey: process.env.PAYSTACK_SECRET_KEY, paystackBaseUrl: process.env.PAYSTACK_BASE_URL, allowSandbox: allowSandbox && process.env.BILLING_SANDBOX !== '0', publicBaseUrl: env.publicBaseUrl });
  const resend = resendFromEnv();
  return { billing: { db, providers: registry, email: resend.configured() ? resend : new NoEmail(), env, now: () => new Date() }, sandbox };
}
export type { Billing, BillingEnv, EmailAdapter, ProviderRegistry };
