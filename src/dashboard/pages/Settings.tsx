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
        <input className="input font-mono" type="password" placeholder="whsec_..." value={value} onChange={(e) => onChange(e.target.value)} />
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
        razorpay_webhook_secret: s.razorpay_webhook_secret ?? '',
        razorpay_filter_ids: s.razorpay_filter_ids ?? '',
      });
    });
  }, [siteId]);

  async function save(patch: Partial<Site>, msg = 'Saved') {
    setError('');
    try {
      const s = await api<Site>(`/api/sites/${siteId}`, { method: 'PATCH', json: patch });
      setSite(s);
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
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl px-4 py-2 text-sm text-white shadow-lg ${error ? 'bg-red-600' : 'bg-ink'}`}>
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

type Provider = 'dodo' | 'stripe' | 'razorpay' | 'api';

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
  const [provider, setProvider] = useState<Provider>(
    site.dodo_webhook_secret ? 'dodo' : site.stripe_webhook_secret ? 'stripe' : site.razorpay_webhook_secret ? 'razorpay' : 'dodo',
  );
  const tabs: { id: Provider; label: string; icon: ReactNode; connected?: boolean }[] = [
    { id: 'dodo', label: 'Dodo Payments', icon: <Favicon domain="dodopayments.com" size={18} />, connected: !!site.dodo_webhook_secret },
    { id: 'stripe', label: 'Stripe', icon: <Favicon domain="stripe.com" size={18} />, connected: !!site.stripe_webhook_secret },
    { id: 'razorpay', label: 'Razorpay', icon: <Favicon domain="razorpay.com" size={18} />, connected: !!site.razorpay_webhook_secret },
    { id: 'api', label: 'Other / API', icon: <span className="font-mono text-xs text-stone-500">{'{ }'}</span> },
  ];
  return (
    <Section title="3. Connect payments" desc="Each payment is linked to the visitor who paid and the source that brought them.">
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
      {provider === 'razorpay' && <RazorpaySetup {...props} />}
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
    ml_visitor_id: jar.get('ml_vid')?.value ?? '',
    ml_session_id: jar.get('ml_sid')?.value ?? '',
  },
});`}</Code>
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
  return (
    <>
      <Steps>
        <Step
          n={1}
          title={
            <>
              In Stripe → <b>Developers → Webhooks</b>, add this endpoint with <code>checkout.session.completed</code>,{' '}
              <code>invoice.paid</code> and <code>charge.refunded</code>:
            </>
          }
        >
          <CopyField value={`${origin}/api/webhooks/stripe/${site.id}`} />
        </Step>
        <Step n={2} title="Paste its signing secret:">
          <SecretField
            value={form.stripe_webhook_secret ?? ''}
            configured={!!site.stripe_webhook_secret}
            onChange={(v) => set({ stripe_webhook_secret: v })}
            onSave={() => save({ stripe_webhook_secret: form.stripe_webhook_secret ?? '' }, 'Stripe connected')}
          />
        </Step>
        <Step n={3} title="Pass the visitor to your checkout:">
          <Code label="checkout.ts">{`const jar = await cookies(); // next/headers

await stripe.checkout.sessions.create({
  // ...your existing options
  success_url: 'https://${site.domain}/thanks?session_id={CHECKOUT_SESSION_ID}',
  metadata: {
    ml_visitor_id: jar.get('ml_vid')?.value ?? '',
    ml_session_id: jar.get('ml_sid')?.value ?? '',
  },
});`}</Code>
          <p className="text-stone-500">
            Using <b>Payment Links</b>? No code needed. Set the link's confirmation page to redirect to{' '}
            <code>https://{site.domain}/thanks?session_id={'{CHECKOUT_SESSION_ID}'}</code>.
          </p>
        </Step>
      </Steps>
      <ProviderFooter anchor="stripe" />
    </>
  );
}

function RazorpaySetup({ site, origin, form, set, save }: RevenueProps) {
  return (
    <>
      <Steps>
        <Step
          n={1}
          title={
            <>
              In Razorpay → <b>Account &amp; Settings → Webhooks</b>, add this URL with <code>payment.captured</code>,{' '}
              <code>order.paid</code>, <code>payment_link.paid</code>, <code>subscription.charged</code> and{' '}
              <code>refund.processed</code>:
            </>
          }
        >
          <CopyField value={`${origin}/api/webhooks/razorpay/${site.id}`} />
        </Step>
        <Step n={2} title="Paste the secret you typed in Razorpay:">
          <SecretField
            value={form.razorpay_webhook_secret ?? ''}
            configured={!!site.razorpay_webhook_secret}
            onChange={(v) => set({ razorpay_webhook_secret: v })}
            onSave={() => save({ razorpay_webhook_secret: form.razorpay_webhook_secret ?? '' }, 'Razorpay connected')}
          />
        </Step>
        <Step n={3} title="Pass the visitor as notes on the order, payment link or subscription:">
          <Code label="checkout.ts">{`const jar = await cookies(); // next/headers
const notes = {
  ml_visitor_id: jar.get('ml_vid')?.value ?? '',
  ml_session_id: jar.get('ml_sid')?.value ?? '',
  ml_site_id: '${site.id}', // needed if one Razorpay account sells several sites' products
};

await razorpay.orders.create({ amount: 49900, currency: 'INR', notes });
// Payment links: razorpay.paymentLink.create({ ...,  notes,
//   callback_url: 'https://${site.domain}/thanks', callback_method: 'get' })`}</Code>
          <p className="text-stone-500">
            Razorpay Checkout in the browser? Put the same keys in its <code>notes</code> option, reading the ids with{' '}
            <code>window.minilytics.attribution()</code>. Amounts are in paise, so set this site's currency to INR.
          </p>
        </Step>
        <Step n={4} title={<>Optional: count only some payment links (<code>plink_…</code>) or plans (<code>plan_…</code>)</>}>
          <div className="flex gap-2">
            <input
              className="input font-mono"
              placeholder="plink_abc123, plan_def456"
              value={form.razorpay_filter_ids ?? ''}
              onChange={(e) => set({ razorpay_filter_ids: e.target.value })}
            />
            <button className="btn-dark" onClick={() => save({ razorpay_filter_ids: form.razorpay_filter_ids ?? '' }, 'Filter saved')}>
              Save
            </button>
          </div>
        </Step>
      </Steps>
      <ProviderFooter anchor="razorpay" />
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
          <p className="mt-1 text-sm text-stone-600">Paste into Claude Code or Cursor in your project. It does steps 1–3 for you.</p>
        </div>
        <CopyButton text={prompt} label="Copy AI prompt" className="btn-dark shrink-0" />
      </div>
      <button className="mt-3 text-sm font-medium text-violet-700 hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide prompt' : 'Preview prompt'}
      </button>
      {open && <pre className="code mt-3 max-h-96 whitespace-pre-wrap">{prompt}</pre>}
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
