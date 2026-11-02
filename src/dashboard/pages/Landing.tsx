import { useEffect, useState, type ReactNode } from 'react';
import { Logo } from '../components/Logo';
import { api, type PlanInfo } from '../lib/api';

export const GITHUB_URL = 'https://github.com/surendrapandar/minilytics';

const SPONSOR_CHECKOUT_URL = 'https://checkout.dodopayments.com/buy/pdt_0NqWPM98xzStsrTUMLyxE?quantity=1';

// Open-source sponsors, same order as the README.
const SPONSORS = [
  {
    name: 'SnitchFeed',
    tagline: 'Agentic social listening for GTM: X, LinkedIn, Reddit & more',
    url: 'https://snitchfeed.com/?utm_source=minilytics&utm_medium=sponsorship&utm_campaign=oss-sponsor&utm_content=website',
    logo: '/sponsors/snitchfeed.png',
  },
  {
    name: 'Open Source Alternatives',
    tagline: 'Find Best Open Source Alternatives to Paid Software',
    url: 'https://www.opensourcealternatives.to/?ref=minilytics-website',
    logo: '/sponsors/opensourcealternatives.png',
  },
  {
    name: 'Awesome Black Friday Deals',
    tagline: 'Black Friday & Cyber Monday deals for devs & indie makers',
    url: 'https://github.com/twf-nikhila/Awesome-Black-Friday-Cyber-Monday-deals',
    logo: '/sponsors/black-friday-deals.png',
  },
  { name: 'DiskMate', tagline: 'Disk space analyzer & cleaner for Mac', url: 'https://diskmate.app/?ref=minilytics-website', logo: '/sponsors/diskmate.svg' },
  { name: 'PasteBuddy', tagline: 'Clipboard history for Mac', url: 'https://pastebuddy.app/?ref=minilytics-website', logo: '/sponsors/pastebuddy.svg' },
];

export function usePlan() {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  useEffect(() => {
    api<PlanInfo>('/api/public/plan').then(setPlan, () => {});
  }, []);
  return plan;
}

export function priceLabel(p: PlanInfo | null) {
  if (!p) return '';
  return p.interval === 'lifetime' ? `${p.price} lifetime` : `${p.price}/${p.interval}`;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function GoogleButton({
  label = 'Continue with Google',
  className = '',
  light = false,
  location,
}: {
  label?: string;
  className?: string;
  light?: boolean;
  /** Where on the page the button is, recorded with the signup_click goal. */
  location?: string;
}) {
  return (
    <a
      href="/api/auth/google"
      data-ml-goal="signup_click"
      data-ml-goal-location={location}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-base font-medium shadow-card transition ${
        light ? 'bg-white text-ink hover:bg-stone-100' : 'bg-ink text-white hover:bg-stone-700'
      } ${className}`}
    >
      <GoogleIcon />
      {label}
    </a>
  );
}

function Section({ id, eyebrow, title, sub, children, className = '' }: { id?: string; eyebrow?: string; title: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto mt-28 max-w-6xl px-4 ${className}`}>
      <div className="mx-auto max-w-2xl text-center">
        {eyebrow && <div className="text-sm font-semibold uppercase tracking-wider text-revenue">{eyebrow}</div>}
        <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        {sub && <p className="mt-3 text-lg text-stone-600">{sub}</p>}
      </div>
      <div className="mt-12">{children}</div>
    </section>
  );
}

function Shot({ src, alt, size, eager = false, className = '' }: { src: string; alt: string; size: [number, number]; eager?: boolean; className?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={size[0]}
      height={size[1]}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      className={`w-full rounded-2xl border border-stone-200 bg-white shadow-xl ${className}`}
    />
  );
}

const Check = () => <span className="text-emerald-600">✓</span>;
const Cross = () => <span className="text-stone-300">✕</span>;

export function Landing() {
  const plan = usePlan();
  const error = new URLSearchParams(window.location.search).get('login_error');
  const spots = plan?.spots && plan.spotsLeft !== null ? { left: plan.spotsLeft, total: plan.spots } : null;
  const price = plan?.price ?? '$29';
  const lifetime = (plan?.interval ?? 'lifetime') === 'lifetime';
  const per = lifetime ? 'lifetime' : `/${plan?.interval}`;
  const priceText = lifetime ? `${price} once` : `${price}/${plan?.interval}`;
  const next = plan?.nextPrice;
  // Earlier prices that already sold out, for "5 sold at $29" proof next to the current price.
  const soldOut = plan?.soldOut ?? [];
  const soldCount = soldOut.reduce((n, t) => n + t.spots, 0);
  const lastSold = soldOut[soldOut.length - 1];
  const cta = plan ? `Get started for ${priceLabel(plan)}` : 'Get started';
  const monthly = plan?.monthly?.price;

  return (
    <div className="min-h-screen overflow-x-hidden">
      {spots && spots.left > 0 && (
        <a href="#pricing" className="block bg-ink px-4 py-2 text-center text-sm text-white" data-ml-goal="pricing_cta" data-ml-goal-location="top-bar">
          {lastSold ? (
            <>
              🔥 First {soldCount} sold out at <s>{lastSold.price}</s>. Now <b>{priceText}</b> · <b>{spots.left}</b> of {spots.total} spots left
            </>
          ) : (
            <>
              🎉 {lifetime ? 'Lifetime deal' : 'Founding offer'}: <b>{priceText}</b>, unlimited everything · <b>{spots.left}</b> of {spots.total} spots left
            </>
          )}
          {next ? `, then ${next}` : ''} →
        </a>
      )}

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo />
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <a href="#how" className="hidden rounded-lg px-3 py-2 text-stone-600 hover:text-ink md:inline">How it works</a>
          <a href="#compare" className="hidden rounded-lg px-3 py-2 text-stone-600 hover:text-ink md:inline">Compare</a>
          <a href="#pricing" className="hidden rounded-lg px-3 py-2 text-stone-600 hover:text-ink sm:inline" data-ml-goal="pricing_cta" data-ml-goal-location="nav">Pricing</a>
          <a href="#sponsors" className="hidden rounded-lg px-3 py-2 text-stone-600 hover:text-ink sm:inline">Sponsors</a>
          <a href={GITHUB_URL} className="hidden rounded-lg px-3 py-2 text-stone-600 hover:text-ink sm:inline">GitHub</a>
          <a href="/api/auth/google" className="btn" data-ml-goal="signup_click" data-ml-goal-location="nav">Sign in</a>
        </nav>
      </header>

      {error && <div className="mx-auto max-w-xl rounded-xl bg-red-50 px-4 py-3 text-center text-sm text-red-700">{error}</div>}

      {/* ---------- Hero */}
      <section className="mx-auto max-w-4xl px-4 pb-12 pt-10 text-center sm:pt-16">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-stone-600 shadow-card">
          <span className="h-2 w-2 rounded-full bg-revenue" /> Revenue-first analytics for indie makers
        </div>
        <h1 className="mt-6 text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          See which tweet, post or AI chat <span className="text-revenue">made you money</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-stone-600 sm:text-xl">
          Minilytics follows every visitor from the first click to the payment, so you know exactly what to post more of. Unlimited
          websites and events, {lifetime ? <>one payment of {price}{monthly ? <>, or {monthly}/month</> : '. No subscription'}.</> : <>{priceText}.</>}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <GoogleButton label={cta} location="hero" />
          <a href="#how" className="btn h-12 px-6 text-base">See how it works</a>
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-stone-500">
          <span>✓ 2-minute setup</span>
          <span>✓ 14-day money-back</span>
          <span>✓ Open source (MIT)</span>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-4">
        <Shot src="/landing/dashboard.png" alt="Minilytics dashboard: visitors, revenue and conversion rate" size={[2160, 1500]} eager />
        <div className="absolute -left-1 top-[42%] hidden rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm shadow-xl md:block lg:-left-6">
          <div className="text-stone-500">Revenue from</div>
          <div className="font-semibold">𝕏 launch-tweet</div>
          <div className="text-xl font-semibold text-revenue">$497</div>
        </div>
        <div className="absolute -right-1 top-[18%] hidden rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm shadow-xl md:block lg:-right-6">
          <div className="text-stone-500">New customer</div>
          <div className="font-semibold">came from ChatGPT</div>
          <div className="text-stone-500">paid 8 days after first visit</div>
        </div>
        <p className="mt-3 text-center text-xs text-stone-400">Demo data</p>
      </section>

      {/* ---------- Problem */}
      <Section eyebrow="The problem" title={<>Your analytics tells you <i>how many</i>. Not <i>who paid</i>.</>}>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['📊', '200 reports, zero answers', 'Google Analytics can tell you about bounce rates in Belgium. It can’t tell you which post sold your product.'],
            ['🫥', 'Visitors aren’t customers', '5,000 visitors from Reddit feels great, until you realise none of them paid. Traffic is a vanity metric without revenue next to it.'],
            ['🕳️', 'Platforms hide the post', 'X, Medium and LinkedIn strip the link, so every tweet shows up as just “t.co”. You never learn which one worked.'],
          ].map(([icon, title, text]) => (
            <div key={title} className="card p-6">
              <div className="text-3xl">{icon}</div>
              <h3 className="mt-3 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-stone-600">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- How it works */}
      <Section id="how" eyebrow="How it works" title="Set up in two minutes. Know forever." sub="No tag manager, no consultants, no 40-page docs.">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['1', 'Add one script tag', 'Paste it in your site’s <head>, or copy the ready-made prompt and let Claude Code / Cursor install it for you.'],
            ['2', 'Connect Stripe or Dodo', 'Add a webhook and every payment is linked to the visitor who made it, and the link that brought them.'],
            ['3', 'See what makes money', 'Revenue next to every source, campaign and page. Post more of what pays, drop what doesn’t.'],
          ].map(([n, title, text]) => (
            <div key={n} className="card p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink font-semibold text-white">{n}</div>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-stone-600">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- Features (real screenshots) */}
      <Section eyebrow="Features" title="Everything you need. Nothing you don’t.">
        <div className="space-y-24">
          <Feature
            title="Revenue next to every source"
            text="Blue is visitors, orange is money. See at a glance that X brings traffic and Indie Hackers brings customers, then click any source to filter the whole dashboard."
            points={['X, Google, ChatGPT, Reddit, YouTube… by name', 'Campaigns and keywords', 'Conversion rate and revenue per visitor']}
            image={<Shot src="/landing/referrers.png" alt="Referrers with revenue" size={[1029, 840]} />}
          />
          <Feature
            reverse
            title="Know exactly which post worked"
            text="Generate a tagged link for each tweet, article or newsletter. It shows up by name, with the visitors and revenue it brought."
            points={['Built-in link builder', 'Works with utm_campaign and ?ref=', 'Credit goes to the post, even if they buy 2 weeks later']}
            image={<Shot src="/landing/campaigns.png" alt="Revenue by campaign" size={[1029, 441]} />}
          />
          <Feature
            title="Every customer’s full journey"
            text="Who paid, where they came from, and how long it took. Open anyone to see every page and click from first visit to payment."
            points={['First source and every visit', 'Button clicks and goals', 'Time from first visit to payment']}
            image={<Shot src="/landing/journey.png" alt="Customer journeys" size={[1428, 785]} />}
          />
          <Feature
            reverse
            title="Watch it happen live"
            text="A real-time globe with every visitor on your site right now, and a feed of page views, clicks and payments as they happen. Turn on the sound and hear every sale."
            points={['3D globe or 2D map', 'Live feed of pages, goals and payments', 'Cha-ching sound on every payment']}
            image={
              <div className="flex justify-center rounded-2xl bg-[#0b1020] p-6 shadow-xl sm:p-10">
                <img src="/landing/feed.png" alt="Live event feed" width={570} height={675} loading="lazy" className="w-full max-w-sm rounded-2xl" />
              </div>
            }
          />
        </div>
      </Section>

      {/* ---------- Comparison */}
      <Section
        id="compare"
        eyebrow="Compare"
        title={lifetime ? <>Pay once. <span className="text-revenue">No limits.</span></> : <>Same price. <span className="text-revenue">No limits.</span></>}
        sub={lifetime ? 'Others charge every month, by traffic and by website. Minilytics is one payment.' : 'Most analytics tools charge by traffic and by website. Minilytics doesn’t.'}
      >
        <div className="card mx-auto max-w-3xl overflow-x-auto p-2">
          <table className="w-full min-w-[520px] text-left">
            <thead>
              <tr className="text-sm text-stone-500">
                <th className="p-4 font-medium" />
                <th className="rounded-t-xl bg-revenueSoft/40 p-4 font-semibold text-ink">Minilytics</th>
                <th className="p-4 font-medium">DataFast Starter</th>
                <th className="p-4 font-medium">Plausible Starter</th>
              </tr>
            </thead>
            <tbody className="text-[15px]">
              {[
                ['Price', monthly ? <>{priceText}<div className="text-sm font-normal text-stone-500">or {monthly}/month</div></> : priceText, '$9/month', '$9/month'],
                ...(lifetime ? [['First year', price, '$108', '$108'], ['Every year after', '$0', '$108', '$108']] : []),
                ['Websites', 'Unlimited', '1', '1'],
                ['Monthly events', 'Unlimited', '10k', '10k pageviews'],
                ['Revenue by traffic source', <Check key="c" />, <Check key="c" />, 'Higher plan'],
                ['Open source / self-host', <Check key="c" />, <Cross key="x" />, <Check key="c" />],
              ].map(([label, a, b, c], i) => (
                <tr key={i} className="border-t border-stone-100">
                  <td className="p-4 text-stone-600">{label}</td>
                  <td className="bg-revenueSoft/40 p-4 font-semibold">{a}</td>
                  <td className="p-4">{b}</td>
                  <td className="p-4">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-xs text-stone-400">
          Based on each product’s public entry-level plan, October 2026. Check their sites for current pricing.
        </p>
      </Section>

      {/* ---------- Founder note (edit this to your own words) */}
      <section className="mx-auto mt-28 max-w-3xl px-4">
        <div className="card p-8 sm:p-10">
          <p className="text-xl leading-relaxed text-stone-700">
            “I built Minilytics because I had no idea which of my posts actually sold my apps. Every analytics tool showed me visitors.
            None showed me money. Now I run my own products on it, and I post more of what pays.”
          </p>
          <div className="mt-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink font-semibold text-white">S</div>
            <div>
              <div className="font-semibold">Surendra</div>
              <div className="text-sm text-stone-500">Maker of DiskMate & PasteBuddy</div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Pricing */}
      <Section id="pricing" eyebrow="Pricing" title={monthly ? 'Everything included. Pay once or monthly.' : 'One plan. Everything included.'}>
        <div className={`mx-auto grid items-start gap-6 ${monthly ? 'max-w-4xl md:grid-cols-[1.15fr_1fr]' : 'max-w-md'}`}>
          <div className={`card relative p-8 ${monthly ? 'ring-2 ring-revenue' : ''}`}>
            {spots && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-revenue px-3 py-1 text-xs font-semibold text-white">
                {lifetime ? (monthly ? 'Lifetime deal · Best value' : 'Lifetime deal') : 'Founding member price'}
              </div>
            )}
            <div className="flex items-baseline gap-1">
              {lastSold && <span className="mr-2 text-3xl font-medium text-stone-400 line-through">{lastSold.price}</span>}
              <span className="text-6xl font-semibold tracking-tight">{price}</span>
              <span className="text-lg text-stone-500">{per}</span>
            </div>
            {soldOut.map((t) => (
              <div key={t.price} className="mt-3 flex items-center gap-2 text-sm text-stone-600">
                <Check /> <span><b className="text-ink">{t.spots} sold</b> at {t.price} · sold out</span>
              </div>
            ))}
            <ul className="mt-6 space-y-2.5">
              {[
                'Unlimited websites',
                'Unlimited events',
                'Revenue attribution with Stripe & Dodo Payments',
                'Customer journeys, goals & funnels',
                'Live globe & real-time feed',
                'AI setup prompt for your codebase',
                plan?.interval === 'lifetime' ? 'Pay once, use forever' : 'Cancel anytime',
              ].map((f) => (
                <li key={f} className="flex gap-2">
                  <Check /> {f}
                </li>
              ))}
            </ul>
            <GoogleButton label="Get started" className="mt-8 w-full" location="pricing" />
            {spots && (
              <div className="mt-5">
                <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full bg-revenue" style={{ width: `${((spots.total - spots.left) / spots.total) * 100}%` }} />
                </div>
                <p className="mt-2 text-center text-sm text-stone-500">
                  <b className="text-ink">{spots.left}</b> of {spots.total} spots left at this price{next ? `, then ${next}` : ''}
                </p>
              </div>
            )}
          </div>
          {monthly && (
            <div className="card p-8">
              <div className="text-sm font-semibold uppercase tracking-wider text-stone-500">Monthly</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-5xl font-semibold tracking-tight">{monthly}</span>
                <span className="text-lg text-stone-500">/month</span>
              </div>
              <p className="mt-4 text-stone-600">Want to try it first? Get the same unlimited plan month to month and cancel anytime.</p>
              <ul className="mt-6 space-y-2.5">
                {['Everything in lifetime', 'Cancel anytime', 'Upgrade to lifetime whenever you like'].map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check /> {f}
                  </li>
                ))}
              </ul>
              <GoogleButton label="Start monthly" light className="mt-8 w-full border border-stone-200" location="pricing-monthly" />
            </div>
          )}
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-stone-600">
          <span className="text-lg">🛡️</span> 14-day money-back guarantee. No questions asked.
        </div>
      </Section>

      {/* ---------- FAQ */}
      <Section title="Questions">
        <div className="mx-auto max-w-2xl space-y-3">
          {[
            ['Is it really unlimited?', 'Yes: unlimited websites and events, within fair use for normal websites.'],
            ['Will it slow down my site?', 'No. The script is about 3.5 KB gzipped and loads after your page.'],
            ['Which payment providers work?', 'Stripe and Dodo Payments work out of the box (one webhook each). Any other provider can send payments with a simple API call.'],
            ['What about ad blockers?', 'You can serve the script from your own domain with a one-line rewrite, so blockers don’t see it. Payments are always recorded either way, because they come from the webhook.'],
            ['Do I need a cookie banner?', 'It uses two first-party cookies and no IP storage. Whether you need a consent banner depends on your visitors’ country; in the EU you may.'],
            ...(monthly
              ? [['Can I pay monthly instead?', `Yes, ${monthly}/month with everything unlimited, cancel anytime. Most people pick lifetime: at ${price} it pays for itself in about ${Math.ceil(Number(price.replace(/[^\d.]/g, '')) / Number(monthly.replace(/[^\d.]/g, '')))} months.`]]
              : []),
            ...(lifetime
              ? [['Is lifetime really lifetime?', 'Yes. Pay once and keep unlimited access for as long as Minilytics runs. No renewals, no surprise bills.']]
              : []),
            [
              'What happens after these spots are gone?',
              next ? `The price goes up to ${next} for new customers. If you’re in, your price never changes.` : 'The price goes up for new customers. If you’re in, your price never changes.',
            ],
            ['Can I self-host it instead?', 'Yes. Minilytics is open source (MIT), and you can deploy it free on your own Cloudflare account from GitHub.'],
          ].map(([q, a]) => (
            <details key={q} className="card group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                {q} <span className="text-stone-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-stone-600">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* ---------- Sponsors. Links open in a new tab so visitors stay on this page. */}
      <section id="sponsors" className="mx-auto mt-28 max-w-4xl scroll-mt-6 px-4">
        <div className="text-center">
          <div className="text-sm font-semibold uppercase tracking-wider text-revenue">Open source sponsors</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">The free, self-hosted version is backed by these makers</h2>
          <p className="mx-auto mt-3 max-w-xl text-stone-600">
            Their support keeps Minilytics MIT-licensed and free to self-host for everyone. Go check out what they’re building.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {SPONSORS.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noopener sponsored"
              data-ml-goal="sponsor_click"
              data-ml-goal-sponsor={s.name}
              className="card flex flex-col items-center p-5 text-center transition hover:-translate-y-0.5 hover:shadow-lg sm:p-6"
            >
              <img src={s.logo} alt="" width={56} height={56} loading="lazy" className="rounded-xl" />
              <div className="mt-3 font-semibold">{s.name}</div>
              <div className="mt-1 text-sm text-stone-600">{s.tagline}</div>
            </a>
          ))}
          <a
            href={SPONSOR_CHECKOUT_URL}
            target="_blank"
            rel="noopener"
            data-ml-goal="sponsor_cta"
            className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-200 p-5 text-center text-sm text-stone-500 transition hover:border-stone-300 hover:text-ink sm:p-6"
          >
            <span className="font-semibold text-ink">Your logo here</span>
            <span className="mt-1">Reach indie hackers who self-host their analytics</span>
            <span className="mt-3 font-medium">Become a sponsor →</span>
          </a>
        </div>
      </section>

      {/* ---------- Final CTA */}
      <section className="mx-auto mt-28 max-w-6xl px-4">
        <div className="rounded-3xl bg-ink px-6 py-14 text-center text-white sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">Find the posts that pay your rent.</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-stone-300">Two minutes to set up. Know what’s working by tomorrow.</p>
          <GoogleButton light label={cta} className="mt-8" location="final-cta" />
          {spots && spots.left > 0 && (
            <p className="mt-4 text-sm text-stone-400">
              {lastSold ? `${soldCount} sold at ${lastSold.price} · ` : ''}
              {spots.left} of {spots.total} spots left at {price} · 14-day money-back
            </p>
          )}
        </div>
      </section>

      <footer className="mx-auto mt-16 flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-stone-200 px-4 py-8 text-sm text-stone-500">
        <Logo small />
        <div className="flex flex-wrap gap-4">
          <a href="/terms" className="hover:text-ink">Terms</a>
          <a href="/privacy" className="hover:text-ink">Privacy</a>
          <a href="/refund" className="hover:text-ink">Refunds</a>
          <a href={GITHUB_URL} className="hover:text-ink">GitHub</a>
          {plan?.supportEmail && (
            <a href={`mailto:${plan.supportEmail}`} className="hover:text-ink">
              {plan.supportEmail}
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}

function Feature({ title, text, points, image, reverse = false }: { title: string; text: string; points: string[]; image: ReactNode; reverse?: boolean }) {
  return (
    <div className={`grid items-center gap-10 md:grid-cols-2 ${reverse ? 'md:[&>*:first-child]:order-2' : ''}`}>
      <div>
        <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h3>
        <p className="mt-3 text-lg text-stone-600">{text}</p>
        <ul className="mt-5 space-y-2">
          {points.map((p) => (
            <li key={p} className="flex gap-2">
              <Check /> {p}
            </li>
          ))}
        </ul>
      </div>
      <div>{image}</div>
    </div>
  );
}
