# Bot analytics

The **crawler traffic panel at the bottom of the dashboard** shows server-reported crawler requests by bot, category and page, plus traffic charts and recent requests. Switch between **AI answers**, **Indexing**, and **Training**, select a crawler to filter the chart, or choose **Pages** to group the chart by requested path. Click the active **Crawlers** or **Pages** control to open its multi-select filter. Page search supports `*` wildcards (for example `/blog/*`). Filters intersect across crawlers and paths; **Clear all** selects none, **All** restores all, and **Reset filters** clears both restrictions. The chart displays up to 10 series and the page picker offers up to 100 paths. Other bots appear in a separate tab when present. It uses the selected date range; human filters do not apply. Counts represent reported requests, not unique bots or verified crawler identities. Bot traffic never creates human sessions or revenue.

Most crawlers do not execute JavaScript. Install server-side reporting on each tracked website; the browser script alone will not populate this view. In your backend, forward the original URL and user agent to:

```js
await fetch('https://YOUR-MINILYTICS-HOST/api/v1/bots', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.MINILYTICS_SITE_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: request.url,
    user_agent: request.headers.get('user-agent') || '',
  }),
});
```

Keep this key on the server. Use your framework's supported background-task mechanism to avoid delaying page responses, and handle reporting failures without failing the page request. Report once per request; retries are counted separately. Requests served from a cache before your reporting code executes are not observed.

Only HTTP(S) URLs matching the key's site or its subdomains are accepted. Ordinary browser user agents are ignored. Stored data contains receipt time, bot label/category, hostname and normalized path; query strings, IPs and raw user agents are not stored. Classification is based on user-agent strings and can be spoofed. Data is retained until the site is deleted; consider storage usage before enabling high-volume reporting.

Apply local migrations, start the dev server, then run `node scripts/smoke-bots.mjs` to test collection and isolation with temporary sites. Before deployment, apply migration `0008_bot_requests.sql` through the normal deployment workflow.

For a 30-day synthetic crawler chart on the local ShipKit demo, run `npm run seed:bots` after the normal demo seed. This replaces bot requests for `demo0001` only. Run `npm run smoke:bots` for bot integration checks.
