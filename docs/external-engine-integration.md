# GitHub Actions engine integration

Stock ScanNet Pro is the presentation layer. AlphaSift and Daily Stock Analysis run as GitHub Actions jobs; no always-on Render service is required for either engine.

## Data flow

- AlphaSift runs its scheduled/manual `Track record` workflow and publishes its current dashboard data to the `track-record` branch at `site/summary.json`.
- Daily Stock Analysis runs its scheduled/manual `每日股票分析` workflow and publishes its latest reports plus `latest.json` to the `engine-results` branch.
- The Stock ScanNet Pro Worker reads those public JSON files from `raw.githubusercontent.com` and exposes read-only endpoints to the UI.
- The Worker does not proxy requests to Render, does not run Python engines, and does not accept public requests to start expensive analysis jobs.

## GitHub Actions workflows

- AlphaSift: [Track record workflow](https://github.com/beeberr/alphasift/actions/workflows/track-record.yml)
- Daily Stock Analysis: [Daily analysis workflow](https://github.com/beeberr/daily_stock_analysis/actions/workflows/00-daily-analysis.yml)

Use each workflow's **Run workflow** control for an immediate manual run. Scheduled runs continue automatically. GitHub may delay scheduled workflows; this is periodic refresh, not a permanently running or tick-by-tick service.

## Stock ScanNet Pro endpoints

- `GET /api/external/status` — latest publication status for both engines.
- `GET /api/external/alphasift/latest` — AlphaSift `site/summary.json`.
- `GET /api/external/dsa/latest` — DSA `latest.json` report manifest.

These are read-only endpoints. They do not need an engine access key because they return only the public, published result files. DSA report links point to the public `engine-results` branch.

## Publishing and permissions

The AlphaSift workflow requires its `track-record` branch to exist and writes results there using the workflow's `contents: write` permission.

The DSA workflow uses the built-in `GITHUB_TOKEN` with `contents: write` to publish generated report files and a versioned manifest to `engine-results`. API keys for data providers and LLMs remain in GitHub Actions Secrets/Variables and are never copied into the public results branch.

## Boundaries and limitations

- GitHub Actions is not a 24/7 server. The UI displays the most recently published run; refresh frequency depends on the workflow schedule and GitHub queue.
- A manual run is started from GitHub Actions, not from an unauthenticated public website button. This avoids putting a GitHub token in the browser or exposing a workflow-dispatch credential through a public Worker.
- AlphaSift's default screening universe is primarily Asian/A-share markets. Do not treat it as a validated US-stock or gold/oil signal without an appropriate strategy and data source.
- DSA output depends on the stock list, provider credentials, AI credentials, and settings already configured in its GitHub repository.
- All results are research only. No live orders or automatic trades are placed.
