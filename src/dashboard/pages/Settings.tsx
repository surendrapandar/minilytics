import { useEffect, useState, type ReactNode } from 'react';
import { navigate } from '../App';
import { Favicon } from '../components/Icons';
import { buildAiPrompt } from '../lib/aiPrompt';
import { api, type Site } from '../lib/api';
import { useT } from '../lib/i18n';

function Section({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-sm text-stone-500">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <code className="code">{children}</code>
      <button
        className="absolute right-2 top-2 rounded-lg bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
        onClick={() => {
          navigator.clipboard.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  );
}

export function Settings({ siteId }: { siteId: string }) {
  const t = useT();
  const [site, setSite] = useState<Site | null>(null);
  const [form, setForm] = useState<Partial<Site>>({});
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const origin = window.location.origin;

  useEffect(() => {
    api<Site>(`/api/sites/${siteId}`).then((s) => {
      setSite(s);
      setForm({ name: s.name, domain: s.domain, timezone: s.timezone, currency: s.currency, dodo_webhook_secret: s.dodo_webhook_secret ?? '' });
    });
  }, [siteId]);

  async function save(patch: Partial<Site>, msg = t('settings.saved')) {
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
  const snippet = `<script\n  defer\n  data-website-id="${site.id}"\n  src="${origin}/js/script.js"\n></script>`;
  const webhookUrl = `${origin}/api/webhooks/dodo/${site.id}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between">
        <button className="btn" onClick={() => navigate(`/site/${site.id}`)}>
          {t('settings.backDashboard')}
        </button>
        <div className="flex items-center gap-2 font-semibold">
          <Favicon domain={site.domain} size={22} /> {site.name}
        </div>
      </div>

      <AiSetup site={site} origin={origin} />

      <Section title={t('settings.s1.title')} desc={<>{t('settings.s1.descPre')} <code>&lt;head&gt;</code> {t('settings.s1.descPost', { domain: site.domain })}</>}>
        <Code>{snippet}</Code>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">{t('settings.s1.nextjsExample')}</summary>
          <div className="mt-3">
            <Code>{`// app/layout.tsx
import Script from 'next/script';

<head>
  <Script defer data-website-id="${site.id}" src="${origin}/js/script.js" strategy="afterInteractive" />
</head>`}</Code>
          </div>
        </details>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium">{t('settings.s1.beatAdblockers')}</summary>
          <p className="mt-2 text-stone-600">
            {t('settings.s1.beatAdblockersDesc')}
          </p>
          <div className="mt-3">
            <Code>{`// next.config.js
async rewrites() {
  return [
    { source: '/stats/script.js', destination: '${origin}/js/script.js' },
    { source: '/stats/event', destination: '${origin}/api/event' },
  ];
}

<script defer data-website-id="${site.id}" data-api="/stats/event" src="/stats/script.js"></script>`}</Code>
          </div>
        </details>
        <p className="mt-4 text-sm text-stone-500">
          {t('settings.s1.excludePre')} <code>https://{site.domain}/?ml_ignore=true</code> {t('settings.s1.excludePost')}
        </p>
      </Section>

      <Section title={t('settings.s2.title')} desc={t('settings.s2.desc')}>
        <Code>{`<!-- Any element: a click sends the goal -->
<button data-ml-goal="signup_click">Get started</button>

<!-- Extra details are attached as properties -->
<a href="/pricing" data-ml-goal="pricing_click" data-ml-goal-plan="pro">Pricing</a>

<script>
  // From your own code
  window.minilytics('goal', 'signup', { plan: 'pro' });

  // After login: attach a name/email to the visitor
  window.minilytics('identify', { user_id: '123', email: 'jane@acme.com', name: 'Jane' });
</script>`}</Code>
        <p className="mt-3 text-sm text-stone-500">{t('settings.s2.outbound')}</p>
      </Section>

      <Section
        title={t('settings.s3.title')}
        desc={t('settings.s3.desc')}
      >
        <ol className="list-decimal space-y-4 pl-5 text-sm">
          <li>
            {t('settings.s3.step1Pre')} <b>{t('settings.s3.step1DevWebhooks')}</b>{t('settings.s3.step1Mid')} <code>payment.succeeded</code> {t('settings.s3.step1And')}{' '}
            <code>refund.succeeded</code>{t('settings.s3.step1End')}
            <div className="mt-2">
              <Code>{webhookUrl}</Code>
            </div>
          </li>
          <li>
            {t('settings.s3.step2Pre')} <b>{t('settings.s3.step2SigningSecret')}</b> {t('settings.s3.step2Mid')} <code>whsec_</code>{t('settings.s3.step2End')}
            <div className="mt-2 flex gap-2">
              <input
                className="input font-mono"
                type="password"
                placeholder={t('settings.s3.secretPlaceholder')}
                value={form.dodo_webhook_secret ?? ''}
                onChange={(e) => setForm({ ...form, dodo_webhook_secret: e.target.value })}
              />
              <button className="btn-dark" onClick={() => save({ dodo_webhook_secret: form.dodo_webhook_secret ?? '' }, t('settings.s3.secretSaved'))}>
                {t('common.save')}
              </button>
            </div>
            {site.dodo_webhook_secret && <p className="mt-1 text-xs text-emerald-600">{t('settings.s3.secretConfigured')}</p>}
          </li>
          <li>
            {t('settings.s3.step3')}
            <div className="mt-2">
              <Code>{`import DodoPayments from 'dodopayments';
import { cookies } from 'next/headers';

const dodo = new DodoPayments({ bearerToken: process.env.DODO_PAYMENTS_API_KEY });
const jar = await cookies();

const session = await dodo.checkoutSessions.create({
  product_cart: [{ product_id: 'pdt_xxx', quantity: 1 }],
  return_url: 'https://${site.domain}/thanks',
  metadata: {
    ml_visitor_id: jar.get('ml_vid')?.value ?? '',
    ml_session_id: jar.get('ml_sid')?.value ?? '',
  },
});`}</Code>
            </div>
            <p className="mt-2 text-stone-500">
              {t('settings.s3.step3NotePre')} <b>{t('settings.s3.step3NotePaymentLinks')}</b> {t('settings.s3.step3NoteMid')} <code>window.minilytics.attribution()</code>{t('settings.s3.step3NoteEnd')}
            </p>
            <p className="mt-2 text-stone-500">
              {(() => {
                const parts = t('settings.s3.step3Note2').split('{identify}');
                return (
                  <>
                    {parts[0]}
                    <code>identify()</code>
                    {parts[1] ?? ''}
                  </>
                );
              })()}
            </p>
          </li>
          <li>
            <b>{t('settings.s3.step4Recommended')}</b> {t('settings.s3.step4Mid')} <b>{t('settings.s3.step4ReturnUrl')}</b>{' '}
            {(() => {
              const parts = t('settings.s3.step4End').split(/\{url\}|\{param\}/);
              return (
                <>
                  {parts[0]}
                  <code>https://{site.domain}/thanks</code>
                  {parts[1]}
                  <code>?payment_id=…</code>
                  {parts[2] ?? ''}
                </>
              );
            })()}
          </li>
        </ol>
      </Section>

      <Section title={t('settings.api.title')} desc={t('settings.api.desc')}>
        <div className="mb-3 flex gap-2">
          <input className="input font-mono" readOnly value={site.api_key} />
          <button
            className="btn"
            onClick={async () => {
              if (!confirm(t('settings.api.rotateConfirm'))) return;
              const r = await api<{ api_key: string }>(`/api/sites/${siteId}/rotate-key`, { method: 'POST' });
              setSite({ ...site, api_key: r.api_key });
            }}
          >
            {t('common.rotate')}
          </button>
        </div>
        <Code>{`curl -X POST ${origin}/api/v1/payments \\
  -H "Authorization: Bearer ${site.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"transaction_id":"txn_123","amount":29.99,"currency":"${site.currency}","visitor_id":"<ml_vid cookie>","email":"jane@acme.com"}'

curl -X POST ${origin}/api/v1/goals \\
  -H "Authorization: Bearer ${site.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"visitor_id":"<ml_vid cookie>","name":"signup"}'`}</Code>
      </Section>

      <LinkBuilder domain={site.domain} />

      <Section title={t('settings.general.title')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{t('settings.general.name')}</label>
            <input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">{t('settings.general.domain')}</label>
            <input className="input" value={form.domain ?? ''} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          </div>
          <div>
            <label className="label">{t('settings.general.timezone')}</label>
            <input className="input" value={form.timezone ?? ''} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
          </div>
          <div>
            <label className="label">{t('settings.general.currency')}</label>
            <input className="input" value={form.currency ?? ''} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </div>
        </div>
        <button className="btn-dark mt-4" onClick={() => save({ name: form.name, domain: form.domain, timezone: form.timezone, currency: form.currency })}>
          {t('settings.general.saveChanges')}
        </button>
      </Section>

      {(saved || error) && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl px-4 py-2 text-sm text-white shadow-lg ${error ? 'bg-red-600' : 'bg-ink'}`}>
          {error || saved}
        </div>
      )}

      <Section title={t('settings.danger.title')}>
        <button
          className="btn border-red-200 text-red-600"
          onClick={async () => {
            if (prompt(t('settings.danger.deleteConfirm', { domain: site.domain })) !== site.domain) return;
            await api(`/api/sites/${siteId}`, { method: 'DELETE' });
            navigate('/');
          }}
        >
          {t('settings.danger.delete')}
        </button>
      </Section>
    </div>
  );
}

/** One-click prompt for the owner's coding AI, so it can install everything in their codebase. */
function AiSetup({ site, origin }: { site: Site; origin: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const prompt = buildAiPrompt(site, origin);
  return (
    <section className="card border-violet-200 bg-gradient-to-br from-violet-50 to-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('settings.ai.title')}</h2>
          <p className="mt-1 max-w-lg text-sm text-stone-600">
            {t('settings.ai.desc')}
          </p>
        </div>
        <button
          className="btn-dark shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? t('settings.ai.copied') : t('settings.ai.copy')}
        </button>
      </div>
      <button className="mt-3 text-sm font-medium text-violet-700 hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? t('settings.ai.hidePrompt') : t('settings.ai.previewPrompt')}
      </button>
      {open && <pre className="code mt-3 max-h-96 whitespace-pre-wrap">{prompt}</pre>}
      <p className="mt-3 text-xs text-stone-500">
        {t('settings.ai.note')}
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
  const t = useT();
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
    <Section
      title={t('settings.link.title')}
      desc={t('settings.link.desc')}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label className="label">{t('settings.link.page')}</label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('settings.link.whereYouPost')}</label>
          <select className="input" value={preset.label} onChange={(e) => setPreset(PRESETS.find((p) => p.label === e.target.value)!)}>
            {PRESETS.map((p) => (
              <option key={p.label}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">{t('settings.link.postName')}</label>
          <input className="input" placeholder={t('settings.link.postNamePlaceholder')} value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </div>
      </div>
      {built && (
        <div className="mt-4">
          <Code>{built}</Code>
        </div>
      )}
      <p className="mt-2 text-xs text-stone-500">
        {t('settings.link.shorterPre')} <code>?ref=launch-tweet</code> {t('settings.link.shorterPost')}
      </p>
    </Section>
  );
}
