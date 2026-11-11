# External engine integration

Stock ScanNet Pro remains the primary application. External Python services are reached through the Cloudflare Worker; credentials and service URLs are never embedded in the browser bundle.

## Cloudflare Worker secrets

Configure these GitHub repository secrets:

- `ALPHASIFT_BASE_URL`: public HTTPS base URL for an AlphaSift `alphasift serve` deployment (for example, `https://alphasift.example.com`).
- `DSA_BASE_URL`: public HTTPS base URL for a running `daily_stock_analysis` API (for example, `https://dsa.example.com`).
- `DSA_AUTH_COOKIE`: optional authenticated session cookie if the DSA deployment has `ADMIN_AUTH_ENABLED=true`. Leave unset when DSA authentication is disabled.
- `EXTERNAL_ENGINE_ACCESS_KEY`: a long random shared key required by the Stock ScanNet Pro external-engine panel.

After adding or changing these secrets, trigger the deployment secret-sync workflow by pushing a commit whose message contains `[sync-secrets]`. The workflow syncs only non-empty values and does not delete existing Cloudflare secrets when a GitHub secret is absent.

## Service requirements

### AlphaSift

Run AlphaSift as a separate Python service and expose its read-only `alphasift serve` API over HTTPS. The Worker currently proxies:

- `GET /health`
- `GET /overview`
- `GET /strategies`
- `GET /runs?limit=10`

The official `serve` API is read-only. It does not trigger a new screening run. A separate authenticated screening runner/API is still required before Stock ScanNet Pro can launch AlphaSift strategies remotely. AlphaSift defaults to A-share strategies/data sources; US-market coverage depends on the selected strategy and configured data providers. It is not a direct gold/oil analysis engine.

### Daily Stock Analysis (DSA)

Run the DSA API continuously (not only as a scheduled GitHub Action). The Worker uses:

- `GET /api/health`
- `POST /api/v1/analysis/analyze` with `async_mode: true`
- `GET /api/v1/analysis/status/{task_id}`

The app accepts a stock ticker and submits an asynchronous detailed report. The DSA API may take several minutes; use the returned task ID to check status. DSA's optional admin authentication is cookie-based; if enabled, set `DSA_AUTH_COOKIE` as a Worker secret.

## Worker routes

All `/api/external/*` routes require the `x-engine-access-key` header to match `EXTERNAL_ENGINE_ACCESS_KEY`. Service URLs must be HTTPS.

- `GET /api/external/status`
- `GET /api/external/alphasift/overview`
- `GET /api/external/alphasift/strategies`
- `GET /api/external/alphasift/runs?limit=10`
- `POST /api/external/dsa/analyze` with JSON `{"stock_code":"AAPL"}`
- `GET /api/external/dsa/status/{task_id}`

The shared access key is entered into the external-engines screen and held only in component memory; it is not saved in localStorage. Treat it as a credential and do not share it. This is a lightweight shared-key gate, not user authentication or per-user rate limiting. For public production use, add Cloudflare Access or equivalent identity/rate-limit controls before enabling expensive analysis endpoints.

## Data and trading boundaries

External results are displayed as research only. They do not place orders, modify demo accounts, or override existing Stock ScanNet Pro engines. Preserve each source's own timestamps, market scope, errors, and data freshness. Never interpret AlphaSift's default A-share screening output as a validated US-stock or commodity signal.
