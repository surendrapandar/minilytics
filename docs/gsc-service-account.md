# Google Search Console (Service Account, self-hosted / admin-only)

This optional integration displays Search Console performance on each site's dashboard. It uses Google's **read-only** `webmasters.readonly` OAuth scope. It does not change the Minilytics tracking script or collect additional visitor identity.

## One-time Google Cloud setup

1. In Google Cloud Console, enable **Google Search Console API** in a project.
2. Create a **Service Account**, generate its JSON key, and record its `client_email`.
3. In **Google Search Console → Settings → Users and permissions**, add that email to every property you want to read. Use an account with sufficient property permissions.
4. Add the JSON **as a Cloudflare Worker Secret**, not as a repository file:

   ```bash
   npx wrangler secret put GSC_SERVICE_ACCOUNT_JSON
   ```

   Paste the **entire JSON key**, then close the terminal. Never commit it, include it in PR comments or copy it into chat.

5. Apply the new D1 migration before using the updated app:

   ```bash
   npx wrangler d1 migrations apply minilytics --remote
   ```

6. Deploy the new Worker from the merged branch. **Cloudflare Builds using only `npm ci && npm run typecheck && npm test && npm run build` do not automatically apply D1 migrations**. Run step 5 as a separate authorized deployment step.

## Connect a website

Sign in as the self-hosted owner or hosted admin. Open the site's Dashboard → **Search Performance** → **Connect Search Console**. Choose a listed property or enter its exact identifier (`sc-domain:example.com` or `https://www.example.com/`). The server verifies it is visible to the configured service account, and stores only the per-site property mapping in D1.

The app supports Queries, Pages, Countries and Devices, with date filtering. The dashboard shows site-level Clicks, Impressions, CTR and average Position, with real daily performance curves and a previous equal-length period comparison. The breakdown table is separate from these site-level totals. Default dates exclude the most recent three calendar days because GSC data can lag. **GSC days are based on Pacific Time**, while other Minilytics charts may use your site's timezone.

## Important boundaries

- This first release is an **on-demand, read-only GSC MVP**, not the daily cached import/cron integration. Opening the panel or changing a dimension issues a Google API request.
- The dimension table fetches at most 250 top rows and may omit anonymized queries. KPI cards come from a separate site-level aggregate request, not the sum of the displayed rows; daily curves come from date-grouped Search Console metrics. Some aggregate and row-level figures may differ because of Google's privacy filtering and reporting rules.
- Each data refresh makes four Search Analytics calls: top dimension rows, daily series, site-level totals, and totals for the previous equal-length period. This is an on-demand implementation, without persisted caching.
- GSC clicks and Minilytics visitors are different metrics. You cannot reliably attribute a payment to an individual GSC search keyword.
- In hosted mode, service-account access is **admin-only**. Other users cannot enumerate service-account properties, change mappings or query GSC data. A future user-facing SaaS integration needs per-user OAuth rather than sharing this private service account.
- A permission or token error appears in the panel without showing the private key. Review Google Cloud API enablement, GSC permissions and the Cloudflare Secret if you see one.

## Security

The private key stays in Cloudflare Secrets; access tokens are stored only in the active Worker isolate for at most one hour. Only read-only OAuth scope is used. Rotate keys through Google Cloud and then update the Cloudflare Secret. Revoke the Service Account's GSC permissions to disconnect it at Google's end.
