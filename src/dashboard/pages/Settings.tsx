import { useEffect, useState, type ReactNode } from 'react';
import { navigate } from '../App';
import { Favicon } from '../components/Icons';
import { buildAiPrompt } from '../lib/aiPrompt';
import { api, type Site } from '../lib/api';
import { fmtMoney } from '../lib/format';

const DOCS = 'https://github.com/surendrapandar/minilytics#';

function Section({ title, desc, docs, children }: { title: string; desc?: ReactNode; docs?: string; children: ReactNode }) {
  return (
    <section className="card p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {docs && <DocsLink anchor={docs} />}
      </div>
      {desc && <p className="mt-1 text-sm text-stone-500">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DocsLink({ anchor, children = 'Docs →' }: { anchor: string; children?: ReactNode }) {
  return (
    <a className="shrink-0 text-sm font-medium text-stone-500 hover:text-ink" href={DOCS + anchor} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

const SMALL_BUTTON = 'rounded-md px-2 py-0.5 text-xs font-medium transition';

function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}

/** A code block with a small header bar, so the copy button never covers the code. */
function Code({ label, children }: { label?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-stone-900">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-1.5">
        <span className="font-mono text-xs text-stone-400">{label}</span>
        <CopyButton text={children} className={`${SMALL_BUTTON} text-stone-300 hover:bg-white/10 hover:text-white`} />
      </div>
      <code className="code rounded-none">{children}</code>
    </div>
  );
}

/** A single line to copy, e.g. a webhook URL. */
function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{value}</code>
      <CopyButton text={value} className={`${SMALL_BUTTON} border border-stone-200 bg-white hover:bg-stone-100`} />
    </div>
  );
}

function SecretField({ value, configured, onChange, onSave }: { value: string; configured: boolean; onChange: (v: string) => void; onSave: () => void }) {
  return (
    <div>
      <div className="flex gap-2">
        <input className="input font-mono" type="password" autoComplete="new-password" aria-label="Webhook signing secret" placeholder="whsec_..." value={value} onChange={(e) => onChange(e.target.value)} />
        <button className="btn-dark" onClick={onSave}>
          Save
        </button>
      </div>
      {configured && <p className="mt-1 text-xs text-emerald-600">✓ Connected</p>}
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="space-y-5 text-sm">{children}</ol>;
}

function Step({ n, title, children }: { n: number; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold text-stone-600">{n}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <p>{title}</p>
        {children}
      </div>
    </li>
  );
}

export function Settings({ siteId }: { siteId: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [form, setForm] = useState<Partial<Site>>({});
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const origin = window.location.origin;

  useEffect(() => {
    api<Site>(`/api/sites/${siteId}`).then((s) => {
      setSite(s);
      setForm({
        name: s.name,
        domain: s.domain,
        timezone: s.timezone,
        currency: s.currency,
        dodo_webhook_secret: s.dodo_webhook_secret ?? '',
        dodo_product_ids: s.dodo_product_ids ?? '',
        stripe_webhook_secret: s.stripe_webhook_secret ?? '',
        stripe_metadata_key: s.stripe_metadata_key ?? '',
        stripe_metadata_value: s.stripe_metadata_value ?? '',
      });
    });
  }, [siteId]);

  async function save(patch: Partial<Site>, msg = 'Saved') {
    setError('');
    try {
      const s = await api<Site>(`/api/sites/${siteId}`, { method: 'PATCH', json: patch });
      setSite(s);
      if ('stripe_webhook_secret' in patch) {
        setForm((current) => ({ ...current, stripe_webhook_secret: s.stripe_webhook_secret ?? '' }));
      }
      if ('stripe_metadata_key' in patch) {
        setForm((current) => ({ ...current, stripe_metadata_key: s.stripe_metadata_key ?? '', stripe_metadata_value: s.stripe_metadata_value ?? '' }));
      }
      setSaved(msg);
      setTimeout(() => setSaved(''), 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!site) return null;
  const set = (patch: Partial<Site>) => setForm({ ...form, ...patch });

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between">
        <button className="btn" onClick={() => navigate(`/site/${site.id}`)}>
          ← Dashboard
        </button>
        <div className="flex items-center gap-2 font-semibold">
          <Favicon domain={site.domain} size={22} /> {site.name}
        </div>
      </div>

      <AiSetup site={site} origin={origin} />

      <Section title="1. Install the script" desc={<>Add it to the <code>&lt;head&gt;</code> of every page on {site.domain}.</>} docs="install-on-a-website">
        <Code label="HTML">{`<script defer data-website-id="${site.id}" src="${origin}/js/script.js"></script>`}</Code>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-stone-600">Next.js, and beating ad blockers</summary>
          <div className="mt-3 space-y-3">
            <Code label="app/layout.tsx">{`import Script from 'next/script';

<Script defer data-website-id="${site.id}" src="${origin}/js/script.js" />`}</Code>
            <p className="text-stone-500">Serve the script from your own domain so ad blockers don't stop it:</p>
            <Code label="next.config.js">{`async rewrites() {
  return [
    { source: '/stats/script.js', destination: '${origin}/js/script.js' },
    { source: '/stats/event', destination: '${origin}/api/event' },
  ];
}
// then: <script defer data-website-id="${site.id}" data-api="/stats/event" src="/stats/script.js"></script>`}</Code>
          </div>
        </details>
        <p className="mt-3 text-sm text-stone-500">
          Skip your own visits: open <code>{site.domain}/?ml_ignore=true</code> once per browser.
        </p>
      </Section>

      <Section title="2. Track goals" desc="Button clicks and key actions, shown in the Goals tab." docs="install-on-a-website">
        <Code label="HTML / JS">{`<button data-ml-goal="signup">Get started</button>

window.minilytics('goal', 'signup', { plan: 'pro' });
window.minilytics('identify', { email: user.email, name: user.name });`}</Code>
      </Section>

      <Revenue site={site} origin={origin} form={form} set={set} save={save} onKeyRotated={(api_key) => setSite({ ...site, api_key })} />

      <LinkBuilder domain={site.domain} />

      <Section title="General">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label className="label">Domain</label>
            <input className="input" value={form.domain ?? ''} onChange={(e) => set({ domain: e.target.value })} />
          </div>
          <div>
            <label className="label">Timezone</label>
            <input className="input" value={form.timezone ?? ''} onChange={(e) => set({ timezone: e.target.value })} />
          </div>
          <div>
            <label className="label">Revenue currency</label>
            <input className="input" value={form.currency ?? ''} maxLength={3} onChange={(e) => set({ currency: e.target.value })} />
          </div>
        </div>
        <button className="btn-dark mt-4" onClick={() => save({ name: form.name, domain: form.domain, timezone: form.timezone, currency: form.currency })}>
          Save changes
        </button>
      </Section>

      {(saved || error) && (
        <div role={error ? 'alert' : 'status'} className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl px-4 py-2 text-sm text-white shadow-lg ${error ? 'bg-red-600' : 'bg-ink'}`}>
          {error || saved}
        </div>
      )}

      <Section title="Danger zone">
        <button
          className="btn border-red-200 text-red-600"
          onClick={async () => {
            if (prompt(`Type ${site.domain} to delete this site and all of its data`) !== site.domain) return;
            await api(`/api/sites/${siteId}`, { method: 'DELETE' });
            navigate('/');
          }}
        >
          Delete site and all data
        </button>
      </Section>
    </div>
  );
}

type Provider = 'dodo' | 'stripe' | 'api';

interface RevenueProps {
  site: Site;
  origin: string;
  form: Partial<Site>;
  set: (patch: Partial<Site>) => void;
  save: (patch: Partial<Site>, msg?: string) => Promise<void>;
  onKeyRotated: (key: string) => void;
}

/** Revenue attribution: pick the payment provider, see only its setup. */
function Revenue(props: RevenueProps) {
  const { site } = props;
  const [provider, setProvider] = useState<Provider>(site.stripe_webhook_secret && !site.dodo_webhook_secret ? 'stripe' : 'dodo');
  const tabs: { id: Provider; label: string; icon: ReactNode; connected?: boolean }[] = [
    { id: 'dodo', label: 'Dodo Payments', icon: <Favicon domain="dodopayments.com" size={18} />, connected: !!site.dodo_webhook_secret },
    { id: 'stripe', label: 'Stripe', icon: <Favicon domain="stripe.com" size={18} />, connected: !!site.stripe_webhook_secret },
    { id: 'api', label: 'Other / API', icon: <span className="font-mono text-xs text-stone-500">{'{ }'}</span> },
  ];
  return (
    <Section title="3. Connect payments" desc="Each payment is linked to the visitor who paid and the source that brought them.">
      <div className="mb-5 grid grid-cols-3 gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setProvider(t.id)}
            className={`relative flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
              provider === t.id ? 'border-ink bg-stone-50 ring-1 ring-ink' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
            }`}
          >
            {t.icon}
            <span className="truncate">{t.label}</span>
            {t.connected && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-emerald-500" title="Connected" />}
          </button>
        ))}
      </div>
      {provider === 'dodo' && <DodoSetup {...props} />}
      {provider === 'stripe' && <StripeSetup {...props} />}
      {provider === 'api' && <ApiSetup {...props} />}
    </Section>
  );
}

function DodoSetup({ site, origin, form, set, save }: RevenueProps) {
  return (
    <>
      <Steps>
        <Step
          n={1}
          title={
            <>
              In Dodo → <b>Developer → Webhooks</b>, add this endpoint with <code>payment.succeeded</code> and <code>refund.succeeded</code>:
            </>
          }
        >
          <CopyField value={`${origin}/api/webhooks/dodo/${site.id}`} />
        </Step>
        <Step n={2} title="Paste its signing secret:">
          <SecretField
            value={form.dodo_webhook_secret ?? ''}
            configured={!!site.dodo_webhook_secret}
            onChange={(v) => set({ dodo_webhook_secret: v })}
            onSave={() => save({ dodo_webhook_secret: form.dodo_webhook_secret ?? '' }, 'Dodo connected')}
          />
        </Step>
        <Step n={3} title="Pass the visitor to your checkout. Payment links need nothing, the script tags them.">
          <Code label="checkout.ts">{`const jar = await cookies(); // next/headers

await dodo.checkoutSessions.create({
  // ...your existing options
  return_url: 'https://${site.domain}/thanks',
  metadata: {
    ...existingMetadata,
    ml_visitor_id: jar.get('ml_vid')?.value ?? '',
    ml_session_id: jar.get('ml_sid')?.value ?? '',
  },
});`}</Code>
          <p className="text-stone-500">
            Keep the return page on this site with the tracker installed. Preserve Dodo's <code>payment_id</code> or{' '}
            <code>subscription_id</code> query parameters until the tracker loads, so it can match payments when metadata is missing.
            For JavaScript redirects, append <code>metadata_ml_visitor_id</code> and <code>metadata_ml_session_id</code> from{' '}
            <code>window.minilytics?.attribution?.()</code>, preserving existing query parameters.
          </p>
        </Step>
      </Steps>
      <details className="mt-5 text-sm">
        <summary className="cursor-pointer font-medium text-stone-600">Selling other products from the same Dodo account?</summary>
        <p className="mt-2 text-stone-500">List this site's product ids so only their payments count.</p>
        <div className="mt-2 flex gap-2">
          <input
            className="input font-mono"
            placeholder="pdt_abc123, pdt_def456"
            value={form.dodo_product_ids ?? ''}
            onChange={(e) => set({ dodo_product_ids: e.target.value })}
          />
          <button className="btn-dark" onClick={() => save({ dodo_product_ids: form.dodo_product_ids ?? '' }, 'Products saved')}>
            Save
          </button>
        </div>
      </details>
      <PendingDodoPayments site={site} />
      <ProviderFooter anchor="dodo-payments" />
    </>
  );
}

const currencyDecimals = (c: string) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
};

interface PendingProduct {
  product_id: string | null;
  count: number;
  amount: number;
  currency: string | null;
}

/** Payments from a product Minilytics couldn't link to any site yet. Rare: most are placed automatically. */
function PendingDodoPayments({ site }: { site: Site }) {
  const [rows, setRows] = useState<PendingProduct[]>([]);
  const load = () => api<PendingProduct[]>(`/api/sites/${site.id}/pending-payments`).then(setRows);
  useEffect(() => {
    load();
  }, [site.id]);
  if (!rows.length) return null;
  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="font-medium text-amber-900">Payments waiting for a site</p>
      <p className="mt-1 text-amber-800">
        These came from a product none of your sites links to yet, so they aren't counted anywhere. They're placed automatically once a buyer
        comes from {site.name}. Know they're {site.name}'s? Count them now.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.product_id ?? ''} className="flex items-center justify-between gap-3">
            <span>
              <code>{r.product_id ?? 'unknown product'}</code> · {r.count} payment{r.count === 1 ? '' : 's'},{' '}
              {fmtMoney(r.amount, r.currency ?? site.currency, currencyDecimals(r.currency ?? site.currency))}
            </span>
            {r.product_id && (
              <button
                className="btn shrink-0"
                onClick={() => api(`/api/sites/${site.id}/pending-payments`, { method: 'POST', json: { product_id: r.product_id } }).then(load)}
              >
                Count for {site.name}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StripeSetup({ site, origin, form, set, save }: RevenueProps) {
  const stripeMarker = site.stripe_metadata_key != null && site.stripe_metadata_value != null
    ? `\n  [${JSON.stringify(site.stripe_metadata_key)}]: ${JSON.stringify(site.stripe_metadata_value)},`
    : '';
  return (
    <>
      <Steps>
        <Step n={1} title={<>In Stripe → <b>Workbench → Webhooks</b>, add this endpoint using <b>snapshot events</b>:</>}>
          <CopyField value={`${origin}/api/webhooks/stripe/${site.id}`} />
          <p>Select exactly these five event types:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><code>payment_intent.succeeded</code></li>
            <li><code>checkout.session.completed</code></li>
            <li><code>checkout.session.async_payment_succeeded</code></li>
            <li><code>refund.created</code></li>
            <li><code>refund.updated</code></li>
          </ul>
        </Step>
        <Step n={2} title="Paste this endpoint's signing secret (whsec_...):">
          <SecretField
            value={form.stripe_webhook_secret ?? ''}
            configured={!!site.stripe_webhook_secret}
            onChange={(v) => set({ stripe_webhook_secret: v })}
            onSave={() => save({ stripe_webhook_secret: form.stripe_webhook_secret ?? '' }, form.stripe_webhook_secret ? 'Stripe webhook secret saved' : 'Stripe disconnected')}
          />
          <p className="text-xs text-stone-500">Leave the masked value unchanged to keep the secret. Clear and save to disconnect Stripe. Minilytics stores no Stripe API key.</p>
        </Step>
        <Step n={3} title="Optionally scope revenue to this site's payments:">
          <form onSubmit={(event) => {
            event.preventDefault();
            void save({ stripe_metadata_key: form.stripe_metadata_key || null, stripe_metadata_value: form.stripe_metadata_value || null }, 'Stripe revenue filter saved');
          }}>
            <fieldset aria-describedby="stripe-filter-help stripe-filter-safety">
              <legend className="font-medium">Optional Stripe revenue filter</legend>
              <p id="stripe-filter-help" className="mt-2 text-stone-600">
                Without a filter, account payments delivered to this endpoint are eligible unless tagged for a different site.
                To accept only marked payments, set both fields. Matching is exact and case-sensitive, including whitespace.
                Clear both fields and save to disable filtering.
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="stripe-metadata-key">Metadata key (up to 40 characters; no square brackets)</label>
                  <input id="stripe-metadata-key" className="input font-mono" type="text" maxLength={40} pattern={'[^\\[\\]]+'}
                    title="Use up to 40 characters, without [ or ]." required={!!form.stripe_metadata_value}
                    value={form.stripe_metadata_key ?? ''} onChange={(event) => set({ stripe_metadata_key: event.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="stripe-metadata-value">Metadata value (up to 500 characters)</label>
                  <input id="stripe-metadata-value" className="input font-mono" type="text" maxLength={500} required={!!form.stripe_metadata_key}
                    value={form.stripe_metadata_value ?? ''} onChange={(event) => set({ stripe_metadata_value: event.target.value })} />
                </div>
              </div>
              <p id="stripe-filter-safety" className="mt-3 text-stone-600">
                The PaymentIntent itself must match the saved rule to add revenue, and Checkout session metadata must match to save context.
                Customer, email, visitor, return-page and subscription matches cannot establish revenue ownership.
                Subscription metadata alone is not enough: unmarked recurring PaymentIntents are excluded even if that customer previously paid.
                Refunds follow an accepted original payment only; an early refund waits outside revenue until its original payment is accepted.
                Rule changes apply prospectively and do not remove or reclassify old revenue.
              </p>
              <button className="btn-dark mt-3" type="submit">Save Stripe revenue filter</button>
              <p className="mt-2 text-xs text-stone-500">Save before copying the setup prompt or code; they use the saved rule. Use a non-secret marker set by your server, not as authorization.</p>
            </fieldset>
          </form>
        </Step>
        <Step n={4} title="Pass the visitor and saved metadata rule to Checkout and its PaymentIntent:">
          <Code label="checkout.ts">{`import { cookies } from 'next/headers';

// Use your application's existing server-side Stripe client and options.
const jar = await cookies();
const attribution = {
  ml_visitor_id: jar.get('ml_vid')?.value ?? '',
  ml_session_id: jar.get('ml_sid')?.value ?? '',
  ml_site_id: ${JSON.stringify(site.id)},${stripeMarker}
};

// One-time payment: preserve existing options and metadata.
const session = await stripe.checkout.sessions.create({
  ...existingCheckoutOptions,
  mode: 'payment',
  success_url: 'https://${site.domain}/thanks?session_id={CHECKOUT_SESSION_ID}',
  metadata: { ...existingCheckoutOptions.metadata, ...attribution },
  payment_intent_data: {
    ...existingCheckoutOptions.payment_intent_data,
    metadata: { ...existingCheckoutOptions.payment_intent_data?.metadata, ...attribution },
  },
});

// Subscription alternative: also mark every PaymentIntent before it succeeds.
const subscriptionSession = await stripe.checkout.sessions.create({
  ...existingSubscriptionCheckoutOptions,
  mode: 'subscription',
  success_url: 'https://${site.domain}/thanks?session_id={CHECKOUT_SESSION_ID}',
  metadata: { ...existingSubscriptionCheckoutOptions.metadata, ...attribution },
  subscription_data: {
    ...existingSubscriptionCheckoutOptions.subscription_data,
    metadata: { ...existingSubscriptionCheckoutOptions.subscription_data?.metadata, ...attribution },
  },
});`}</Code>
          <p className="text-stone-500">
            Create Checkout after the tracker is ready. If your checkout API is on another domain, send{' '}
            <code>window.minilytics?.attribution?.()</code> in the request body and merge those IDs on your server.
            Directly created PaymentIntents also need their own attribution and saved marker.
          </p>
          <p className="text-stone-500">
            Checkout events save visitor, PaymentIntent, customer and subscription context only; unpaid sessions and free trials never add revenue.
            Subscription metadata is not automatically copied to PaymentIntents. In filtered mode, your billing integration must mark each
            PaymentIntent before it succeeds; this subscription example alone does not make initial or renewal charges eligible.
            Customer mapping supplies attribution only after the PaymentIntent passes the filter.
          </p>
          <p className="text-stone-500">
            Keep <code>ml_site_id</code> set to <code>{site.id}</code>: a different site ID on Checkout or a PaymentIntent is ignored.
            This site tag does not replace the configured metadata rule. If the rule uses <code>ml_site_id</code> as its key, its value must be this site's ID.
            Load the tracker on your return page and preserve <code>session_id</code> until it loads, so accepted payments can be linked to the returning visitor.
          </p>
        </Step>
        <Step n={5} title="Using Stripe Payment Links?">
          <p>
            The tracker automatically tags <code>buy.stripe.com</code> anchor links with{' '}
            <code>client_reference_id=ml_&lt;visitor_id&gt;__&lt;session_id&gt;</code>, preserving your own non-Minilytics reference.
            For JavaScript redirects, add it yourself once the tracker is ready:
          </p>
          <Code label="Browser redirect">{`const link = new URL('https://buy.stripe.com/your_payment_link');
const attribution = window.minilytics?.attribution?.();
const reference = link.searchParams.get('client_reference_id');
if (attribution?.ml_visitor_id && attribution.ml_session_id && (!reference || reference.startsWith('ml_'))) {
  link.searchParams.set('client_reference_id', 'ml_' + attribution.ml_visitor_id + '__' + attribution.ml_session_id);
}
window.location.assign(link.toString());`}</Code>
          <p className="text-stone-500">
            Set the confirmation redirect to <code>https://{site.domain}/thanks?session_id={'{CHECKOUT_SESSION_ID}'}</code>.
            The compound reference supplies visitor and session fallback; legacy raw visitor references still work without a session ID.
            If you already use this field for your own reference, use server-created Checkout with metadata for exact attribution instead of overwriting it.
            Neither the link reference nor the return page bypasses filtering: both Checkout and its PaymentIntent need the configured marker.
            Configure metadata propagation in your payment integration; automatic link tagging cannot add the required PaymentIntent metadata.
          </p>
        </Step>
      </Steps>
      <ProviderFooter anchor="stripe" note="Only payment_intent.succeeded adds income, using amount_received in Stripe minor units, including subscriptions. Only succeeded refunds subtract revenue, deduplicated by refund ID. Invoices paid outside Stripe, credits and legacy charges without a PaymentIntent are excluded. Do not also forward Stripe payments through the generic payments API. Match the site's revenue currency to the charge currency; no Stripe FX conversion is performed and mixed-currency totals are not comparable." />
    </>
  );
}

function ApiSetup({ site, origin, onKeyRotated }: RevenueProps) {
  return (
    <>
      <p className="mb-3 text-sm text-stone-500">Any other provider: send payments from your backend with this site's API key.</p>
      <div className="mb-4 flex gap-2">
        <input className="input font-mono" readOnly value={site.api_key} />
        <button
          className="btn"
          onClick={async () => {
            if (!confirm('Rotate the API key? The old key stops working immediately.')) return;
            const r = await api<{ api_key: string }>(`/api/sites/${site.id}/rotate-key`, { method: 'POST' });
            onKeyRotated(r.api_key);
          }}
        >
          Rotate
        </button>
      </div>
      <Code label="POST /api/v1/payments">{`curl -X POST ${origin}/api/v1/payments \\
  -H "Authorization: Bearer ${site.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "transaction_id": "txn_123",
    "amount": 29.99,
    "currency": "${site.currency}",
    "visitor_id": "<ml_vid cookie>",
    "email": "jane@acme.com"
  }'`}</Code>
      <ProviderFooter anchor="other-providers-api" note="Refunds, renewals and server-side goals are covered in the guide." />
    </>
  );
}

function ProviderFooter({ anchor, note = 'No metadata? Payments are still matched by return page, email or timing.' }: { anchor: string; note?: string }) {
  return (
    <p className="mt-5 border-t border-stone-100 pt-4 text-sm text-stone-500">
      {note} <DocsLink anchor={anchor}>Full guide →</DocsLink>
    </p>
  );
}

/** One-click prompt for the owner's coding AI, so it can install everything in their codebase. */
function AiSetup({ site, origin }: { site: Site; origin: string }) {
  const [open, setOpen] = useState(false);
  const prompt = buildAiPrompt(site, origin);
  return (
    <section className="card border-violet-200 bg-gradient-to-br from-violet-50 to-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">✨ Set up with AI</h2>
          <p className="mt-1 max-w-lg text-sm text-stone-600">
            Copy this prompt into Claude Code, Cursor or any coding AI opened in your project. It installs the script, connects your Dodo or Stripe
            attribution, identifies users and adds button goals, using this site's real values. It detects the payment provider already in your code.
          </p>
        </div>
        <CopyButton text={prompt} label="Copy AI prompt" className="btn-dark shrink-0" />
      </div>
      <button className="mt-3 text-sm font-medium text-violet-700 hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide prompt' : 'Preview prompt'}
      </button>
      {open && <pre className="code mt-3 max-h-96 whitespace-pre-wrap">{prompt}</pre>}
      <p className="mt-3 text-xs text-stone-500">
        The AI handles the code. You still connect your provider's webhook yourself using the Dodo or Stripe setup below.
      </p>
    </section>
  );
}

const PRESETS = [
  { label: 'X / Twitter', source: 'x', medium: 'social' },
  { label: 'LinkedIn', source: 'linkedin', medium: 'social' },
  { label: 'Reddit', source: 'reddit', medium: 'social' },
  { label: 'YouTube', source: 'youtube', medium: 'video' },
  { label: 'Medium', source: 'medium', medium: 'article' },
  { label: 'Newsletter', source: 'newsletter', medium: 'email' },
  { label: 'Product Hunt', source: 'producthunt', medium: 'referral' },
];

/** Build a tagged link per tweet / article, so each one shows up separately in Campaign. */
function LinkBuilder({ domain }: { domain: string }) {
  const [url, setUrl] = useState(`https://${domain}/`);
  const [preset, setPreset] = useState(PRESETS[0]);
  const [campaign, setCampaign] = useState('');
  let built = '';
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', preset.source);
    u.searchParams.set('utm_medium', preset.medium);
    if (campaign) u.searchParams.set('utm_campaign', campaign.trim().toLowerCase().replace(/\s+/g, '-'));
    built = u.toString();
  } catch {}
  return (
    <Section title="Link builder" desc="Tag the link in each post to see which one brought visitors and revenue (Referrer → Campaign)." docs="tracking-a-specific-tweet--article">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label className="label">Page</label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <label className="label">Where you post it</label>
          <select className="input" value={preset.label} onChange={(e) => setPreset(PRESETS.find((p) => p.label === e.target.value)!)}>
            {PRESETS.map((p) => (
              <option key={p.label}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Post name</label>
          <input className="input" placeholder="launch-tweet" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </div>
      </div>
      {built && (
        <div className="mt-4">
          <CopyField value={built} />
        </div>
      )}
    </Section>
  );
}
