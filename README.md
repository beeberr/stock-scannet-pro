# Stock Scanner Pro

Private, single-user Hebrew RTL market-research and paper-trading workspace. This repository is intentionally maintained for one operator, not as a public SaaS product.

## Private-use architecture
- No public signup, customer accounts, subscriptions, billing, or multi-tenant product features are planned.
- Provider credentials are stored only as Cloudflare Worker secrets; never commit API keys to Git.
- Private use does not automatically waive provider restrictions. Check each provider's personal-use, caching, storage, display, and derived-data terms before relying on it.

## Current application
- Responsive Hebrew/RTL dashboard with eight separately defined research engines.
- Watchlist for equities, ETFs, indices, gold, oil, and selected commodities.
- Two independent local demo accounts with unit-based buy/sell ledger, weighted average cost, fees, financing, cash checks, position quantities, and realized P&L.
- Legacy demo balances and trade history migrate without inventing execution prices or quantities.
- Dedicated forecast journal and public-disclosure monitoring screens.
- Technical analysis module: validated OHLCV candles, SMA20/SMA50, RSI14, ATR14 and MACD.
- Long-only research signal engine: trend, RSI, MACD, volume and candle confirmation; ATR-based stop/target levels; configurable risk budget and position sizing; explicit exit-rule evaluation. It never submits orders.
- Live quote endpoint with Twelve Data as primary and Alpaca IEX as automatic per-symbol fallback.
- Provider diagnostics endpoint reports whether credentials are configured without exposing secrets.
- Commodity quotes currently use Yahoo Finance's unofficial futures endpoint; this is a temporary integration and must be replaced or validated against an explicitly permitted source before it is treated as dependable.

## Provider secrets
Set these as Cloudflare Worker secrets only when the corresponding provider account and terms permit the intended private use:
- `TWELVE_DATA_API_KEY` — primary quote provider.
- `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` — optional IEX fallback.

The quote endpoint tries Twelve Data first for each requested symbol. If that provider errors or returns an invalid quote, it tries Alpaca IEX for that symbol. One provider failure does not discard successful quotes for other symbols. Unavailable quotes remain explicitly unavailable; the API does not fabricate prices. The UI should display each quote's own `source` and timestamp.

Useful private diagnostics:
- `GET /api/health` — Worker health/version.
- `GET /api/providers` — configured-provider status (never returns credential values).
- `GET /api/quotes` — normalized quote set for the allowed watchlist symbols.
- `GET /api/commodities` — current temporary commodity integration.

## Eight planned research engines
1. Technical trend and indicators.
2. Short-term momentum and risk/reward.
3. Fundamental value and company quality.
4. Macro, central-bank and bank research.
5. Gold and oil supply/demand analysis.
6. Indices, ETFs and sector rotation.
7. News, earnings and event analysis.
8. Verified public disclosures, SEC filings and public-official transaction reports.

## Safety and measurement
A monthly doubling target is tracked only as an aspiration, never represented as realistic or guaranteed. Signals must be timestamped, source-attributed, testable, and evaluated including fees, spreads, slippage and financing. Public-official and insider transactions are displayed only when supported by official disclosures; filing dates and transaction dates must remain separate. Market prices are research inputs, not investment advice.

## Verification
`npm run build`, `npm run test:paper`, `npm run test:market`, and `npm run test:signal`.

## Next milestones
- Add provider-level contract tests for timeouts, malformed data, partial outages, fallback and stale timestamps.
- Add licensed historical OHLCV ingestion and connect it to the technical and signal engines.
- Add caching/rate-limit budgets appropriate to free tiers.
- Add fundamental data and official SEC/public-disclosure ingestion.
- Replace the unofficial commodity endpoint with a permitted source or explicitly disable unsupported symbols.
- Implement backtests with walk-forward evaluation, realistic spreads/slippage/fees, and a persistent forecast journal.
- Add private cloud persistence and backups after data/security design is reviewed.
- Deploy only after verification; keep production on the existing Cloudflare Worker.
