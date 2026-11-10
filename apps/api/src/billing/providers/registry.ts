import { HubtelProvider } from './hubtel';
import { PaystackProvider } from './paystack';
import { SandboxProvider } from './sandbox';
import { ProviderError, type Provider } from './types';

/** Chooses a provider for each kind of payment. A configured real provider always wins over the sandbox. */
export class ProviderRegistry {
  constructor(private providers: Provider[]) {}
  get(id: string): Provider {
    const p = this.providers.find((x) => x.caps.id === id);
    if (!p) throw new ProviderError('UNKNOWN_PROVIDER', `Unknown payment provider "${id}"`);
    return p;
  }
  find(id: string): Provider | undefined { return this.providers.find((x) => x.caps.id === id); }
  list(): Provider[] { return this.providers; }
  forCheckout(): Provider {
    const p = this.providers.find((x) => x.caps.oneOff && x.configured() && !x.caps.sandbox) ?? this.providers.find((x) => x.caps.oneOff && x.configured());
    if (!p) throw new ProviderError('NO_PROVIDER', 'No payment provider is configured yet. Mansora will send payment details instead.');
    return p;
  }
  forMandate(method: 'card' | 'momo'): Provider {
    const wanted = (x: Provider) => (method === 'card' ? x.caps.recurringCard : x.caps.recurringMomo);
    const p = this.providers.find((x) => wanted(x) && x.configured() && !x.caps.sandbox) ?? this.providers.find((x) => wanted(x) && x.configured());
    if (p) return p;
    if (method === 'momo') throw new ProviderError('PROVIDER_BLOCKED', 'Automatic Mobile Money payments are not available yet. You can still pay each invoice by Mobile Money using the payment link.');
    throw new ProviderError('NO_PROVIDER', 'Automatic card payments are not available yet.');
  }
}

export interface ProviderEnv { paystackSecretKey?: string; paystackBaseUrl?: string; allowSandbox: boolean; publicBaseUrl: string; fetch?: typeof fetch }
export function createProviders(env: ProviderEnv): { registry: ProviderRegistry; sandbox?: SandboxProvider } {
  const list: Provider[] = [new PaystackProvider({ secretKey: env.paystackSecretKey, baseUrl: env.paystackBaseUrl, fetch: env.fetch }), new HubtelProvider()];
  let sandbox: SandboxProvider | undefined;
  if (env.allowSandbox) { sandbox = new SandboxProvider(env.publicBaseUrl); list.push(sandbox); }
  return { registry: new ProviderRegistry(list), sandbox };
}
