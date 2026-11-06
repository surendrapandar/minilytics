import type { Site } from './api';

/**
 * A copy-paste prompt for the site owner's coding AI (Claude Code, Cursor, Copilot…),
 * filled with this site's real values so the AI can install tracking and revenue attribution itself.
 * The API key and webhook secret are deliberately left out: the integration doesn't need them in code.
 */
export function buildAiPrompt(site: Site, origin: string): string {
  const script = `<script defer data-website-id="${site.id}" src="${origin}/js/script.js"></script>`;
  return `You are setting up Minilytics analytics + revenue attribution in this codebase. Minilytics is my self-hosted analytics (like DataFast / Plausible). Do the work directly in the code. Only ask me questions about things you cannot find out by reading the codebase, and ask them all together, up front, before making changes.

## My Minilytics values (already correct — use them as-is)
- Dashboard / API host: ${origin}
- Website ID: ${site.id}
- Tracked domain: ${site.domain} (all subdomains such as app.${site.domain} count as the same site)
- Revenue currency: ${site.currency}
- Script tag:
  ${script}

## Task 1 — Install the tracking script on every page
- Find how this project renders the HTML <head> (e.g. Next.js app/layout.tsx or pages/_document.tsx, Vite/CRA index.html, Astro/Nuxt/SvelteKit/Remix root layout, plain HTML files, WordPress header.php…) and add the script tag so it loads on EVERY page, including the logged-in app and any subdomains that live in this repo.
- Next.js: use next/script: <Script defer data-website-id="${site.id}" src="${origin}/js/script.js" strategy="afterInteractive" />
- Keep the exact attributes. Load it once only. Single-page-app navigation is tracked automatically; do not add manual pageview calls.
- If the project has a Content-Security-Policy, allow ${origin} in script-src and connect-src.

## Task 2 — Revenue attribution with Dodo Payments or Stripe (most important)
The script stores two first-party cookies: \`ml_vid\` (visitor id) and \`ml_sid\` (session id). Every Dodo or Stripe payment must carry them as metadata so Minilytics knows which visitor (and therefore which tweet / article / Google page) made the money.
- Search the codebase for payment code. Dodo: "dodopayments", "DodoPayments", "checkoutSessions.create", "payments.create", "subscriptions.create", "checkout.dodopayments.com", "/buy/". Stripe: "stripe", "checkout.sessions.create", "buy.stripe.com".
- Where a checkout/payment/subscription is created on the SERVER, read the cookies from the incoming request and MERGE them into the existing metadata (never drop existing metadata keys):
    metadata: { ...existingMetadata, ml_visitor_id: <cookie ml_vid> ?? '', ml_session_id: <cookie ml_sid> ?? '' }
  Next.js App Router example: const jar = await cookies(); jar.get('ml_vid')?.value
- If the checkout request is made from the BROWSER to the server (fetch/axios), it normally already sends cookies on the same domain. If the API is on a different domain, read the ids in the browser with window.minilytics.attribution() (returns { ml_visitor_id, ml_session_id }) and send them in the request body, then put them in metadata on the server.
- Static Dodo payment links (<a href="https://checkout.dodopayments.com/buy/...">) need no change — the script adds metadata to them automatically on click. But if code redirects to a payment link with JavaScript (window.location = ...), append the params yourself: ?metadata_ml_visitor_id=<id>&metadata_ml_session_id=<id> using window.minilytics.attribution().
- Make sure every checkout has a return/redirect URL on this site (e.g. return_url: 'https://${site.domain}/thanks' for checkout sessions, or ?redirect_url=... on payment links), and that page loads the Minilytics script. Dodo appends ?payment_id=... (or ?subscription_id=...) to it, and Minilytics uses that to link the payment to the visitor even if metadata is lost. Keep those query params on the URL (don't strip them before the page loads).
- Stripe Checkout: put the same two keys in the session's metadata, and make success_url a page on this site ending in ?session_id={CHECKOUT_SESSION_ID} (Stripe fills it in; Minilytics uses it to match the payment). Stripe Payment Links (buy.stripe.com) need no change — the script sets client_reference_id on click, unless the code already sets its own.
- Do NOT touch payment webhooks in this codebase for Minilytics. I connect them myself in the provider's dashboard (Dodo: ${origin}/api/webhooks/dodo/${site.id}, Stripe: ${origin}/api/webhooks/stripe/${site.id}).

## Task 3 — Identify logged-in users
Right after a successful login/signup (and on app load when a user session exists), call:
  window.minilytics?.('identify', { user_id: user.id, email: user.email, name: user.name })
This links anonymous visits to the person, and is a fallback for attributing payments by email.

## Task 4 — Track key buttons as goals
Add data attributes to the most important calls-to-action (no JS needed), using short snake_case names:
  <button data-ml-goal="signup_click">  ·  data-ml-goal="start_trial"  ·  data-ml-goal="pricing_cta"  ·  data-ml-goal="checkout_click"
Optional details: data-ml-goal-plan="pro". From code: window.minilytics?.('goal', 'signup_completed', { plan: 'pro' }).
Track at least: the main signup/get-started button(s), pricing-page plan buttons, and the checkout/buy button. Also fire window.minilytics?.('goal', 'signup_completed') after a successful signup.

## TypeScript
If the project uses TypeScript, add a global declaration so calls type-check:
  declare global { interface Window { minilytics?: ((cmd: 'goal' | 'identify' | 'pageview', a?: any, b?: any) => void) & { attribution?: () => { ml_visitor_id?: string; ml_session_id?: string } } } }
Always call it with optional chaining (window.minilytics?.(...)) so pages never break if the script is blocked.

## Rules
- Make minimal, focused changes that match the existing code style. Don't refactor unrelated code.
- Don't hardcode secrets. None are needed for this setup.
- The script ignores localhost by default. To test locally add data-allow-localhost to the script tag temporarily (remove it before committing), or test on the deployed site.

## When you are done, reply with
1. A list of every file you changed and why.
2. Which checkout/payment code paths now send ml_visitor_id / ml_session_id (and any you could not find or were unsure about).
3. Which goals you added and where.
4. How I can verify: open the site, in DevTools → Network a POST to ${origin}/api/event returns 202, and the visit appears in my Minilytics dashboard within seconds.`;
}
