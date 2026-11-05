# Stock Scanner Pro

Hebrew RTL investment research and paper-trading workspace.

## Initial frontend delivered
- Responsive Hebrew/RTL dashboard scaffold.
- Eight separately defined analysis engines and clear connection status.
- Watchlist for equities, ETFs, indices, gold and oil.
- Two independent local demo accounts with unit-based buy/sell ledger, weighted average cost, fees, financing, cash checks, position quantities, and realized P&L.\n- Legacy demo balances and trade history are migrated without inventing execution prices or quantities.\n- Regression tests for trade accounting, insufficient cash, overselling, validation, and legacy migration.
- Dedicated forecast journal and public-disclosure monitoring screens.
- First standalone technical-analysis module: validated OHLCV candles, SMA20/SMA50, RSI14, ATR14 and MACD, with no automatic buy/sell recommendation.
- Regression tests for technical indicators, insufficient history, malformed candles and chronological ordering.
- Explicit warning labels: no live quotes, no fabricated scores, and no implied recommendations.

## Not connected yet
No market-data provider, bank research feed, broker, SEC/public-official disclosure feed, authentication, cloud database, or automated forecast engine is connected. Watchlist symbols are identifiers only, not current prices or signals. Demo records are stored in the current browser only.

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
- Add automated typecheck/build verification.
- Integrate licensed market data and fundamental data.
- Add bank research sources where access and redistribution are permitted.
- Add official SEC and public-disclosure ingestion.
- Connect the technical-analysis module to a licensed market-data provider with timestamps, stale-data handling, timeout/retry and caching.
- Implement and backtest the remaining engines with a forecast journal.
- Add verified market-data sources and mark-to-market valuation with source timestamps; keep market value unavailable when quotes are missing.\n- Add cloud persistence and authentication after data and security design is reviewed.
- Deploy only after verification, on a hosting platform selected independently of AppDeploy.
