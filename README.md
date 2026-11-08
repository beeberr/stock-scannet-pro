# Stock Scanner Pro

Hebrew RTL investment research and paper-trading workspace.

## Initial frontend delivered
- Responsive Hebrew/RTL dashboard scaffold.
- Eight separately defined analysis engines and clear connection status.
- Watchlist for equities, ETFs, indices, gold and oil.
- Two independent local demo accounts with unit-based buy/sell ledger, weighted average cost, fees, financing, cash checks, position quantities, and realized P&L.
- Legacy demo balances and trade history are migrated without inventing execution prices or quantities.
- Regression tests for trade accounting, insufficient cash, overselling, validation, and legacy migration.
- Dedicated forecast journal and public-disclosure monitoring screens.
- First standalone technical-analysis module: validated OHLCV candles, SMA20/SMA50, RSI14, ATR14 and MACD.
- First scored long-only signal engine: trend, RSI, MACD, volume and candle confirmation; ATR-based stop/target levels; configurable risk budget and position sizing; explicit exit-rule evaluation. It produces research candidates only and never submits orders.
- Regression tests for technical indicators, insufficient history, malformed candles, chronological ordering, signal scoring, position sizing and exit rules.
- Explicit warning labels: no live quotes, no fabricated scores, and no implied recommendations.

## Asset universe and provider boundaries
The research watchlist is capped at 50 assets: 20 equities, 8 commodities, 8 indices and 9 ETFs (45 configured initially), with 5 reserved rotating slots. The shared registry is served by `/api/universe`; duplicate symbols and cap drift fail fast at module initialization. A configured asset is not necessarily price-connected.

Only AAPL, MSFT, NVDA and XLE currently have a stock-quote adapter (Twelve Data); GC, SI, HG and CL currently have the Massive Futures adapter. Other watchlist assets remain visible but explicitly unconnected until a compatible free-tier provider and API credential are configured. The app must never manufacture a quote or describe a delayed/historical value as real-time.

## Not connected yet
Massive Futures integration is implemented but requires the MASSIVE_API_KEY GitHub Actions secret before the Worker can retrieve data. The free Futures Basic tier returns historical session bars with an 8-hour delay and a 5-requests-per-minute limit. The app never labels these as live prices. Stock quotes still require TWELVE_DATA_API_KEY. No broker, SEC/public-official disclosure feed, authentication, cloud database, or automated forecast engine is connected. Demo records are stored in the current browser only.

## Eight planned engines
1. Technical trend and indicators.
2. Short-term momentum and risk/reward.
3. Fundamental value and company quality.
4. Macro, central-bank and bank research.
5. Gold and oil supply/demand analysis.
6. Indices, ETFs and sector rotation.
7. News, earnings and event analysis.
8. Verified public disclosures, SEC filings and public-official transaction reports.

## Safety and measurement
A monthly doubling target is tracked only as an aspiration, never represented as a realistic or guaranteed return. Signals must be timestamped, source-attributed, testable, and evaluated including fees, spreads, slippage and financing. Public-official and insider transactions are displayed only when supported by official disclosures; filing dates and transaction dates must be kept separate.

## Next milestones
- Add automated typecheck/build verification and signal-engine regression tests.
- Add MASSIVE_API_KEY to GitHub repository secrets and verify live API responses from the Worker; validate contract roll selection against actual volume before relying on signals.\n- Integrate licensed stock and fundamental data.
- Add bank research sources where access and redistribution are permitted.
- Add official SEC and public-disclosure ingestion.
- Connect the technical-analysis module to a licensed market-data provider with timestamps, stale-data handling, timeout/retry and caching.
- Implement and backtest the remaining engines with a forecast journal.
- Add verified market-data sources and mark-to-market valuation with source timestamps; keep market value unavailable when quotes are missing.
- Add cloud persistence and authentication after data and security design is reviewed.
- Deploy only after verification, on a hosting platform selected independently of AppDeploy.
