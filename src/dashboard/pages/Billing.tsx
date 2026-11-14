import { useEffect, useState } from 'react';
import { BackButton } from '../components/BackButton';
import { navigate, useMe } from '../App';
import { Logo } from '../components/Logo';
import { api } from '../lib/api';
import { priceLabel, usePlan } from './Landing';

/** Cheaper way in for people who want to try it first. Lifetime stays the highlighted choice. */
function MonthlyOption({ price, lifetime }: { price: string; lifetime: string }) {
  const months = Math.ceil(Number(lifetime.replace(/[^\d.]/g, '')) / Number(price.replace(/[^\d.]/g, '')));
  return (
    <div className="mt-6 border-t border-stone-100 pt-5">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Or pay monthly</span>
        <span>
          <span className="text-xl font-semibold">{price}</span>
          <span className="text-stone-500">/month</span>
        </span>
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Same unlimited plan, cancel anytime.{Number.isFinite(months) && months > 1 ? ` Lifetime pays for itself in ${months} months.` : ''}
      </p>
      <a
        href="/api/billing/checkout?plan=monthly"
        className="btn mt-3 h-11 w-full"
        data-ml-goal="checkout_click"
        data-ml-goal-plan="monthly"
        data-ml-goal-price={price}
      >
        Start monthly for {price}/month
      </a>
    </div>
  );
}

export function Billing() {
  const { me, refresh } = useMe();
  const plan = usePlan();
  const user = me.user!;
  const justPaid = new URLSearchParams(window.location.search).get('paid') === '1';
  const [waiting, setWaiting] = useState(justPaid && !user.paid);
  const [timedOut, setTimedOut] = useState(false);

  // Dodo sends people back before its webhook may have arrived; keep checking for a minute or two.
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      const m = await refresh();
      if (m.user?.paid) {
        clearInterval(t);
        setWaiting(false);
        navigate('/');
      } else if (tries > 40) {
        clearInterval(t);
        setWaiting(false);
        setTimedOut(true);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting, refresh]);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('ml:logout'));
    navigate('/');
  }

  const until = user.plan_until ? new Date(user.plan_until).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const ended = ['expired', 'failed', 'on_hold', 'paused', 'refunded', 'cancelled'].includes(user.plan_status) && !user.paid;

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="flex items-center justify-between gap-2">
        {user.paid ? <BackButton /> : <Logo />}
        <button className="btn" onClick={logout}>
          Log out
        </button>
      </div>

      <div className="card mt-10 p-8">
        <div className="flex items-center gap-3">
          {user.avatar && <img src={user.avatar} alt="" className="h-10 w-10 rounded-full" referrerPolicy="no-referrer" />}
          <div className="min-w-0">
            <div className="truncate font-semibold">{user.name ?? user.email}</div>
            <div className="truncate text-sm text-stone-500">{user.email}</div>
          </div>
        </div>

        {user.paid ? (
          <>
            <div className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {user.admin ? '✓ Owner account: free, unlimited.' : '✓ Your plan is active.'}
              {!user.admin && (until ? ` Access until ${until}${user.plan_status === 'cancelled' ? ' (cancelled)' : ', renews automatically'}.` : ' Paid for life.')}
            </div>
            {!user.admin && plan?.supportEmail && (
              <p className="mt-3 text-xs text-stone-500">
                To cancel or change billing, email{' '}
                <a className="underline" href={`mailto:${plan.supportEmail}`}>
                  {plan.supportEmail}
                </a>
                .
              </p>
            )}
            <button className="btn-dark mt-6 w-full" onClick={() => navigate('/')}>
              Go to dashboard →
            </button>
            {user.plan === 'monthly' && user.plan_status === 'active' && plan?.checkout && plan.interval === 'lifetime' && (
              <div className="mt-6 rounded-xl border border-stone-200 p-4 text-sm">
                <div className="font-medium">Switch to lifetime for {plan.price}</div>
                <p className="mt-1 text-stone-500">
                  Pay once and stop paying monthly.{plan.supportEmail ? ` After paying, email ${plan.supportEmail} and we'll cancel your subscription.` : ''}
                </p>
                <a
                  href="/api/billing/checkout"
                  className="btn mt-3 w-full"
                  data-ml-goal="checkout_click"
                  data-ml-goal-plan="lifetime-upgrade"
                  data-ml-goal-price={plan.price}
                >
                  Upgrade to lifetime →
                </a>
              </div>
            )}
          </>
        ) : waiting ? (
          <div className="mt-8 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-stone-200 border-t-ink" />
            <p className="mt-4 font-medium">Confirming your payment…</p>
            <p className="mt-1 text-sm text-stone-500">This usually takes a few seconds.</p>
          </div>
        ) : (
          <>
            {ended && <div className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Your plan has ended. Renew to keep tracking.</div>}
            {timedOut && (
              <div className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                We haven't received the payment confirmation yet. Refresh this page in a minute
                {plan?.supportEmail ? ` or email ${plan.supportEmail}` : ''}.
              </div>
            )}
            <div className="mt-6 text-sm font-medium uppercase tracking-wider text-revenue">
              {plan?.interval === 'lifetime' ? 'Lifetime deal' : 'Founding member'}
              {plan?.monthly && <span className="ml-2 rounded-full bg-revenue px-2 py-0.5 text-[11px] text-white">Best value</span>}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-semibold">{plan?.price ?? ''}</span>
              <span className="text-stone-500">{plan ? (plan.interval === 'lifetime' ? 'lifetime' : `/${plan.interval}`) : ''}</span>
            </div>
            <ul className="mt-4 space-y-1.5 text-sm">
              {['Unlimited websites', 'Unlimited events', 'Revenue attribution, journeys, live globe'].map((f) => (
                <li key={f}>
                  <span className="text-emerald-600">✓</span> {f}
                </li>
              ))}
            </ul>
            {plan?.checkout ? (
              <a
                href="/api/billing/checkout"
                className="btn-dark mt-6 h-12 w-full text-base"
                data-ml-goal="checkout_click"
                data-ml-goal-plan={plan.interval === 'lifetime' ? 'lifetime' : plan.interval}
                data-ml-goal-price={plan.price}
              >
                Pay {priceLabel(plan)} →
              </a>
            ) : (
              <p className="mt-6 text-sm text-stone-500">Checkout isn't configured yet.</p>
            )}
            {plan?.spots && plan.spotsLeft !== null ? (
              <p className="mt-3 text-center text-xs text-stone-500">
                {plan.spotsLeft} of {plan.spots} spots left at this price{plan.nextPrice ? `, then ${plan.nextPrice}` : ''}
              </p>
            ) : null}
            {plan?.monthly && <MonthlyOption price={plan.monthly.price} lifetime={plan.price} />}
          </>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-stone-400">
        <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refund">Refunds</a>
      </p>
    </div>
  );
}
