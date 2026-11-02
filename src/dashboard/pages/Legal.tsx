import { BackButton } from '../components/BackButton';
import { Logo } from '../components/Logo';
import { usePlan } from './Landing';

// Plain-language starting points. Review them (or have a lawyer do it) before you rely on them.
const UPDATED = 'October 2026';

export function Legal({ page }: { page: 'terms' | 'privacy' | 'refund' }) {
  const plan = usePlan();
  const contact = plan?.supportEmail ? (
    <a className="underline" href={`mailto:${plan.supportEmail}`}>
      {plan.supportEmail}
    </a>
  ) : (
    'the support email on our website'
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between gap-2">
        <BackButton />
        <a href="/">
          <Logo />
        </a>
      </div>
      <article className="card mt-8 space-y-4 p-8 text-[15px] leading-relaxed text-stone-700 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-ink [&_h2]:pt-2 [&_h2]:font-semibold [&_h2]:text-ink">
        {page === 'terms' && (
          <>
            <h1>Terms of Service</h1>
            <p className="text-sm text-stone-500">Last updated {UPDATED}</p>
            <p>By using Minilytics ("the service") you agree to these terms.</p>
            <h2>The service</h2>
            <p>
              Minilytics provides website analytics and revenue attribution. You add a tracking script to websites you own or are allowed
              to manage, and you can connect a payment provider to see which traffic sources lead to payments.
            </p>
            <h2>Your account</h2>
            <p>You sign in with Google and are responsible for activity under your account. One account per person or business.</p>
            <h2>Payment</h2>
            <p>
              Paid plans are billed through Dodo Payments, our merchant of record, at the price shown at checkout. Subscriptions renew
              automatically until cancelled; cancelling stops future charges and keeps access until the end of the paid period.
            </p>
            <h2>Acceptable use</h2>
            <p>
              Only track sites you have the right to track, follow the privacy laws that apply to your visitors (including showing any
              cookie or consent notice they require), and don't use the service for spam, abuse or anything illegal. "Unlimited" means
              no fixed caps for normal websites; we may limit traffic that harms the service.
            </p>
            <h2>Availability</h2>
            <p>
              We work to keep the service running and your data safe, but it's provided "as is" without guarantees of uptime or fitness
              for a particular purpose. To the extent the law allows, our liability is limited to the amount you paid in the last 12
              months.
            </p>
            <h2>Ending</h2>
            <p>You can stop using the service at any time. We may suspend accounts that break these terms.</p>
            <h2>Contact</h2>
            <p>Questions: {contact}.</p>
          </>
        )}
        {page === 'privacy' && (
          <>
            <h1>Privacy Policy</h1>
            <p className="text-sm text-stone-500">Last updated {UPDATED}</p>
            <h2>Your account</h2>
            <p>
              When you sign in with Google we receive your name, email address and profile picture. We use them to run your account and
              contact you about it. Payments are processed by Dodo Payments; we never see your full card details.
            </p>
            <h2>Your visitors</h2>
            <p>
              For websites you track, the script records pages viewed, referrers, campaign tags, button clicks you choose to track,
              approximate location (country, region, city, coordinates rounded to about 1 km), browser, operating system and device. It
              uses two first-party cookies (a random visitor id and a session id) and does not store IP addresses. Email addresses in page
              URLs are removed before sending. You decide whether to link visitors to customers (for example with payment metadata or
              identify()).
            </p>
            <p>
              For this data, you are the controller and we process it on your behalf to provide your analytics. We don't sell it or use
              it for advertising.
            </p>
            <h2>Where it's stored</h2>
            <p>Data is stored on Cloudflare's infrastructure. You can delete a website and all its data at any time from its settings.</p>
            <h2>Contact</h2>
            <p>Privacy questions or deletion requests: {contact}.</p>
          </>
        )}
        {page === 'refund' && (
          <>
            <h1>Refund Policy</h1>
            <p className="text-sm text-stone-500">Last updated {UPDATED}</p>
            <p>
              If Minilytics isn't right for you, email {contact} within 14 days of your first payment for a full refund, no questions
              asked.
            </p>
            <p>
              After that, you can cancel anytime to stop future charges; you keep access until the end of the period you've paid for.
              Refunds are issued through Dodo Payments to your original payment method.
            </p>
          </>
        )}
      </article>
    </div>
  );
}
