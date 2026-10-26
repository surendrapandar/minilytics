# Minilytics

Revenue-first web analytics for your own websites, inspired by DataFast. It shows where visitors came from (which
tweet, article, Google page or AI assistant), what they did, and **which source made you money**. It runs on
Cloudflare's free plan.

![Dashboard](docs/dashboard.png)

## Sponsors

<table>
  <tr>
    <td align="center" width="33%">
      <a href="https://diskmate.app/?ref=minilytics-github"><img src="docs/sponsors/diskmate.svg" width="64" height="64" alt="DiskMate"></a><br>
      <a href="https://diskmate.app/?ref=minilytics-github"><b>DiskMate</b></a><br>
      <sub>Disk space analyzer &amp; cleaner for Mac</sub>
    </td>
    <td align="center" width="33%">
      <a href="https://pastebuddy.app/?ref=minilytics-github"><img src="docs/sponsors/pastebuddy.svg" width="64" height="64" alt="PasteBuddy"></a><br>
      <a href="https://pastebuddy.app/?ref=minilytics-github"><b>PasteBuddy</b></a><br>
      <sub>Clipboard history for Mac: never lose what you copy</sub>
    </td>
    <td align="center" width="33%">
      <a href="https://checkout.dodopayments.com/buy/pdt_0NqWPM98xzStsrTUMLyxE?quantity=1"><b>Your logo here</b></a><br>
      <sub>Reach indie hackers and developers who self-host their analytics</sub><br><br>
      <a href="https://checkout.dodopayments.com/buy/pdt_0NqWPM98xzStsrTUMLyxE?quantity=1">Become a sponsor →</a>
    </td>
  </tr>
</table>

<p align="center">
  <a href="https://checkout.dodopayments.com/buy/pdt_0NqWPM98xzStsrTUMLyxE?quantity=1"><img src="https://img.shields.io/badge/Become%20a%20sponsor-%2419%2Fmonth%20early%20price-e07b5f?style=for-the-badge" alt="Become a sponsor: $19/month early price"></a>
</p>

## What it tracks

- **Visitors, revenue, conversion rate, revenue per visitor, bounce rate, session time, online now**, each with a % change against the previous period
- A chart of visitors (line) and revenue (bars), hourly, daily, weekly or monthly
- Date ranges: today, yesterday, last 24h, last 2 days, 7/30/90 days, 12 months, all time and custom, with ‹ › to step back and forward
- **Where visitors come from**: channel, referrer (X, Google, ChatGPT, Reddit…), campaign (`utm_campaign`), keyword (`utm_term`), `?ref=` tags
- **Where they are and what they use**: country, region, city, browser, OS, device
- **What they did**: pages, entry pages, exit links (outbound clicks), button clicks and custom goals, funnels
- **Who paid**: a Journey list of every customer with their source, amount, time to convert, and a full visitor timeline (visit → pages → clicks → payment)
- Click any row to filter the whole dashboard (for example "only visitors from the launch tweet")
- Multiple websites, one login

## Deploy for free (about 10 minutes)

Every person deploys **their own copy** on their own free Cloudflare account. Your data stays on your account, and you
get your own dashboard with its own password.

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up), [Node.js 20+](https://nodejs.org) and Git.
Run these commands in a terminal on your computer. You only do this once; afterwards the app runs on Cloudflare.

**1. Download the code and log in to Cloudflare**

```bash
git clone https://github.com/surendrapandar/minilytics.git
cd minilytics
npm install
npx wrangler login          # opens your browser; click "Allow"
```

**2. Create the database**

```bash
npx wrangler d1 create minilytics
```

If Wrangler asks *"Would you like Wrangler to add it on your behalf?"*, answer **No**. Answer **No** to the optional
"Cloudflare skills" questions too. Then copy the printed `database_id` and paste it into `wrangler.jsonc`, replacing
`00000000-0000-0000-0000-000000000000`. There must be exactly **one** entry under `d1_databases`, with `"binding": "DB"`.

**3. Set your password and a signing secret**

```bash
npx wrangler secret put ADMIN_PASSWORD     # the password you'll log in with (use a strong one)
npx wrangler secret put SESSION_SECRET     # any long random text, e.g. the output of: openssl rand -hex 32
```

Typing is hidden; that's normal. If asked *"There doesn't seem to be a Worker called minilytics… create it?"*, answer **Yes**.

**4. Deploy**

```bash
npm run deploy
```

This builds the dashboard, creates the database tables and deploys. It prints your link, e.g.
`https://minilytics.<you>.workers.dev`. Open it, log in, add a website and copy its script tag. Each site's Settings
page also has a **Copy AI prompt** button that lets Claude Code / Cursor do the install in your codebase for you.

If you see `fetch failed`, it's a network hiccup (VPN, proxy, Wi-Fi). Run `npm run deploy` again.

You can attach a custom domain such as `analytics.yourdomain.com` in Cloudflare → Workers & Pages → minilytics →
Settings → Domains & Routes.

**Updating later**

```bash
git stash          # keeps your database_id edit in wrangler.jsonc safe
git pull
git stash pop
npm run deploy
```

### What the free plan covers

| Cloudflare free limit | What it means here |
| --- | --- |
| 100,000 Worker requests/day | About 100k tracked events per day across all sites. The script and dashboard files are static and don't count. |
| 100,000 D1 rows written/day | About 10k pageviews per day |
| 5M D1 rows read/day | A dashboard load reads roughly 10 times the sessions in the range, so with 10k visitors/month that's hundreds of loads a day |
| 5 GB D1 storage | Years of data at side-project traffic |

At 5–10k visitors a month you'll use a few percent of this. If you outgrow it, Cloudflare's Workers Paid plan is $5/month.

## Install on a website

```html
<script defer data-website-id="SITE_ID" src="https://YOUR-MINILYTICS-HOST/js/script.js"></script>
```

- **Button clicks / goals:** `<button data-ml-goal="signup_click">`, or `window.minilytics('goal', 'signup', { plan: 'pro' })`
- **Identify logged-in users:** `window.minilytics('identify', { user_id, email, name })`
- **Ignore your own visits:** open `https://yoursite.com/?ml_ignore=true` once per browser
- **Single-page apps** (Next.js, React Router…) are handled automatically
- **Subdomains:** `app.yoursite.com` and `yoursite.com` share the same visitor, because the cookie is set on the root domain

### Tracking a specific tweet / article

X, Medium, LinkedIn and others hide which exact post sent someone; the referrer only says `t.co` or `medium.com`.
To see the exact post, tag each link. Settings has a link builder for this:

```
https://yoursite.com/?utm_source=x&utm_medium=social&utm_campaign=launch-tweet
https://yoursite.com/?ref=launch-tweet            (short version)
```

For SEO, Google never shares the search keyword, but **Entry page** with the **Google** referrer tells you which
article people found you through.

## Revenue attribution with Dodo Payments

1. In Dodo → Developer → Webhooks, add `https://YOUR-HOST/api/webhooks/dodo/SITE_ID` and subscribe to
   `payment.succeeded` and `refund.succeeded`. Paste the signing secret (`whsec_…`) into the site settings.
2. Pass the visitor cookies as metadata when creating a checkout:

```ts
const jar = await cookies(); // next/headers
await dodo.checkoutSessions.create({
  product_cart: [{ product_id: 'pdt_xxx', quantity: 1 }],
  metadata: { ml_visitor_id: jar.get('ml_vid')?.value ?? '', ml_session_id: jar.get('ml_sid')?.value ?? '' },
});
```

Using Dodo **payment links**? The script adds `metadata_ml_visitor_id` / `metadata_ml_session_id` to any
`checkout.dodopayments.com` link when it's clicked. That metadata doesn't always reach the payment, so also do step 3.

3. Recommended: set the checkout's return / redirect URL to a page on your site (e.g. `/thanks`) that loads the
   script. Dodo adds `?payment_id=…` to it, and Minilytics uses that to link the payment to the exact visitor even when
   metadata doesn't come through.

**How credit is given:** a payment goes to the paying visitor's last visit that came from a real source (last non-direct
touch). So "clicked a tweet, came back directly 17 days later and paid" is credited to the tweet. If metadata is
missing, Minilytics tries, in order: the return page (`?payment_id=`), an earlier payment by the same customer
(renewals), an email you `identify()`'d, and finally checkout timing (used only when exactly one visitor clicked a Dodo
checkout link in the 3 hours before the payment). The Journey tab shows how each payment was matched, and **Try
matching again** re-runs this for older payments.
Refunds are subtracted from revenue.

## Revenue attribution with Stripe

In a site's Settings, use **Connect Stripe**. Add the displayed endpoint
(`https://YOUR-HOST/api/webhooks/stripe/SITE_ID`) in Stripe **Workbench → Webhooks**, choose **snapshot events**
for your own account, and select:

- `payment_intent.succeeded`
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `refund.created`
- `refund.updated`

Save that endpoint's `whsec_…` signing secret in the site's Stripe settings. Minilytics does not need a Stripe API
key or SDK. Keep your application's existing fulfillment/subscription webhooks unchanged. Use separate sites and
endpoint secrets for sandbox and live traffic so test payments do not contaminate production analytics.

### Optional per-site revenue filter

By default, **all account payments delivered to a site's endpoint are eligible**; the site's domain, visitor IDs,
customer history and Checkout links do not isolate products sharing a Stripe account. In Settings → Connect Stripe,
set the optional metadata key and value, then save. The key must be nonempty, at most 40 characters and contain no
`[` or `]`; the value must be nonempty and at most 500 characters. Matching is exact and case-sensitive, including
whitespace. Clear **both** fields and save to restore all-account behavior. The API fields are
`stripe_metadata_key` and `stripe_metadata_value`: both strings enable filtering, both `null` disable it; partial
pairs are rejected. Apply migration `0005_stripe_scope.sql` before deploying this feature.

With filtering enabled:

- Each `payment_intent.succeeded` object's **own** `metadata[key]` must equal the configured value to enter revenue.
  Customer, email, visitor, subscription or Checkout associations cannot establish revenue ownership.
- Checkout session metadata must independently match the same rule before any attribution context is saved.
  Mark **both** the session and its PaymentIntent, preserving existing attribution IDs and metadata.
- Subscription metadata alone is insufficient: Stripe does not automatically copy it to recurring PaymentIntents.
  Unmarked recurring PaymentIntents are excluded even if the customer previously paid. Your billing integration
  must ensure each PaymentIntent carries the marker before it succeeds; the subscription Checkout example alone
  does not guarantee renewal revenue. Do not infer ownership from a previously accepted subscription or customer.
- Only succeeded, nonzero refunds against an accepted original payment subtract revenue. A refund that arrives
  first waits outside the payments table until its original matching payment is accepted; it does not independently
  establish ownership or affect totals. Refund metadata need not carry the marker.

Rule changes are **prospective**: setting, changing or clearing the filter does not delete or reclassify old revenue.
Use a fresh site if a clean historical boundary is required. Save the rule before copying the Settings code example
or AI setup prompt; they include the saved marker as a safely escaped dynamic key/value, without API keys or webhook
secrets. Use a non-secret marker chosen by your application and assigned on the server, not arbitrary browser input.
This filter is analytics scoping, not authorization or a substitute for Stripe webhook signature verification.

### Checkout metadata

Pass the tracking cookies in Checkout metadata **and** on the underlying PaymentIntent:

```ts
const jar = await cookies(); // next/headers; use your existing server-side Stripe client
const attribution = {
  ml_visitor_id: jar.get('ml_vid')?.value ?? '',
  ml_session_id: jar.get('ml_sid')?.value ?? '',
  // If filtering is enabled, also add your configured marker here:
  // [configuredMetadataKey]: configuredMetadataValue,
};
await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ price: 'price_xxx', quantity: 1 }],
  success_url: 'https://YOUR-SITE/thanks',
  metadata: attribution,
  payment_intent_data: { metadata: attribution },
});
```

Merge these values with existing metadata instead of replacing your application's fields. For `mode: 'subscription'`,
keep session `metadata` and replace `payment_intent_data` with `subscription_data: { metadata: attribution }`.
Matching Checkout events retain customer context for later subscription charges, including trials with no first payment.
Subscription metadata is not automatically copied to recurring PaymentIntents. With filtering enabled, mark each
PaymentIntent before it succeeds; the subscription example alone is not enough. Customer mapping only supplies
attribution after the PaymentIntent passes the filter. Direct PaymentIntent integrations should put both the IDs
and any configured marker in the PaymentIntent's own metadata.

For **Stripe Payment Links**, append `client_reference_id=<ml_visitor_id>` using
`window.minilytics?.attribution?.()` once the tracker is ready. Preserve existing query parameters. The tracking
script does not rewrite Stripe links automatically. If your application already uses `client_reference_id`, use
server-created Checkout metadata instead of overwriting it. Missing tracking cookies cannot provide exact attribution.
This visitor fallback does not bypass a configured revenue filter: the session and PaymentIntent still need the marker.

**Accounting:** only successful, positive PaymentIntent `amount_received` adds revenue. Checkout events add context,
not money; subscribing to invoice notifications does not count the same payment again. PaymentIntent IDs and refund
IDs are namespaced per site, so retries and concurrent deliveries do not duplicate income. Successful partial/full
refunds subtract money once; pending/failed refunds do not. Late Checkout context is reconciled without replacing
existing attributed history. In filtered mode, refunds received before an accepted original payment remain outside
revenue until that payment arrives and passes the rule; unfiltered behavior is unchanged. Repeated customer payments use the
existing renewal/repeat-purchase flag. Invoices paid outside Stripe, credits, disputes, and legacy charges without a
PaymentIntent are not included. Do not also forward these same payments through the generic payments API.

Match the site's revenue currency to the Stripe charge currency. Stripe amounts are normalized to the dashboard's
currency units (including ISK/UGX), but **no exchange-rate conversion is performed**. Mixed-currency site totals sum
amounts and are not comparable. Configure a separate site per currency if necessary.

Webhook signatures use the exact raw payload, HMAC-SHA256 and a five-minute timestamp tolerance. Clearing or rotating
the saved Stripe secret takes effect immediately. If Cloudflare blocks webhook deliveries, inspect its Security
Events and exempt only the webhook path from the relevant challenge rule; keep signature verification enabled.

## Other payment providers

Other providers can use the generic API (the key is in site settings):

```bash
curl -X POST https://YOUR-HOST/api/v1/payments -H "Authorization: Bearer ml_..." -H "Content-Type: application/json" \
  -d '{"transaction_id":"txn_1","amount":29.99,"currency":"USD","visitor_id":"<ml_vid cookie>","email":"jane@acme.com"}'
```

## Accuracy notes

No analytics tool is 100% accurate. These are the main gaps and how this project handles them:

- **Ad blockers** block some analytics domains. Proxy the script through your own domain (Settings shows a Next.js
  rewrite). Payments are always recorded by the webhook, even when the visitor's browser blocked tracking.
- **Safari** keeps cookies set by JavaScript for at most 7 days. A Safari visitor who returns after more than a week counts as new. The
  email fallback above recovers most of these payments.
- **Bots** are filtered by user agent and the `navigator.webdriver` flag.
- Revenue in a different currency than the site's is converted only when Dodo gives a settlement amount in the site's currency.

## Local development

```bash
cp .dev.vars.example .dev.vars        # password: change-me
npm run db:migrate:local
npm run build && npm run dev:api      # http://localhost:8787
npm run dev:web                       # optional: hot-reloading dashboard on http://localhost:5173

npm run seed                          # optional: 30 days of demo data ("ShipKit" site)
npm test                              # unit tests
npm run smoke                         # end-to-end test against the running dev server
npm run smoke:stripe                  # Stripe signed-event / real Worker+D1 regression flow
```

## How it's built

- `public/js/script.js`: the tracker, 9 KB (about 3.5 KB gzipped). It handles cookies, pageviews, engaged time, goals, outbound links and Dodo link tagging
- `src/worker`: a Hono app on Cloudflare Workers that handles event ingestion, Dodo and Stripe webhooks, the payments and goals API, and stats queries on D1 (SQLite)
- `src/dashboard`: the React dashboard (Vite, Tailwind, Recharts), served as static files by the same Worker
- `migrations/`: the database schema

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm run typecheck && npm test`.

## License

[MIT](LICENSE): free to use, modify and self-host, including commercially.
