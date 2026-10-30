# Cloudflare Builds CI/CD

Configured 2026-10-30 for the user-owned fork `waterme7on/minilytics`; do not push deployment work to the upstream `surendrapandar/minilytics`.

- Existing Worker: `minilytics`; production hostname unchanged.
- Production branch: `main`; other branches do not deploy.
- Root: `/`.
- Build: `npm ci && npm run typecheck && npm test && npm run build`.
- Deploy: `npx wrangler deploy --keep-vars`.
- Build variables: `NODE_VERSION=22`, `WRANGLER_SEND_METRICS=false`.
- Existing authorized deployment credential is stored as a Cloudflare Builds token; never store its value in Git.
- GitHub Actions is disabled at repository level.
- Watch paths: all code; exclude `docs/**` and `*.md` to avoid docs-only deployments.

## First verified release

- Exact code commit: `9322389e7bc766ba469806a0674a86149e1fb6c4`.
- Cloudflare build: `cfc5625e-b956-480a-b983-54e0fe1fa745`, success.
- Active version: `4b6fe18f-6a5e-4bdf-9bf5-4a7a12f2be70`.
- Read-only live checks: `/`, `/api/auth/me`, `/api/public/plan`, `/js/script.js` return 200. `OPTIONS /api/event` returns 204 and permits POST from the test origin.
- DB and secret binding names/types/DB identifier match the pre-release configuration. No database migration, seed, event submission, order or payment was executed. Authentication and actual event persistence were not tested.
- No DNS or runtime secrets were changed. Docs-only merge does not require another deployment.

## Future changes

Push/merge code to `main` to trigger Cloudflare Builds. A failed build must not be called a release. Verify the build commit, active Worker version, tracker asset and public/read-only endpoints. Review required D1 migrations separately before code that depends on schema changes is deployed; the current command does not automatically apply them.
