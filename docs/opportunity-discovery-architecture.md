# Opportunity Discovery — implementation contract

## Product outcome

The primary screen must rank uncommon US equities that are showing fresh, unusual activity. The goal is discovery and research, not merely provider health. The scanner must explain why a symbol surfaced, identify the exact source and timestamp, show whether the data is delayed, and retain enough information to measure what happened after the alert.

## Current verified boundary

The current Worker has a Twelve Data stock-candle adapter limited in code to AAPL, MSFT, NVDA and XLE. It requests 80 daily candles and caches successful responses for 15 minutes. The existing asset registry contains 20 configured equities but only those four are connected to the stock-candle adapter. The AlphaSift and Daily Stock Analysis integrations read published GitHub Actions output; they are not tick-by-tick scanners. Their publication cadence is controlled by GitHub Actions and the source projects.

Therefore the current production system cannot honestly claim to scan the US equity universe, find small-cap breakouts in real time, or support live scalping. This feature must not present four daily-candle symbols as a market-wide scanner.

## First implementation slice

The new provider-independent ranking function accepts fresh 1-minute or 5-minute OHLCV input. It evaluates:
- 20-bar intraday breakout and proximity to breakout;
- VWAP position and short-window trend;
- bullish candle close;
- relative-volume estimate, only when current session volume, average daily volume and session progress are supplied;
- average daily dollar-volume and minimum-price liquidity gates;
- data freshness, source attribution and limitations.

The relative-volume calculation is explicitly a linear time-of-session estimate, not a seasonality-adjusted RVOL. Missing volume/liquidity inputs produce PARTIAL and cannot produce a BREAKOUT or EARLY_MOMENTUM signal. Stale or insufficient candles cannot produce a candidate.

## Data-provider requirement before live activation

Twelve Data documents the market movers endpoint at 100 API credits per request and says it is available on Pro/Venture plans; the current Basic plan is documented as 8 API credits per minute and 800 per day. The endpoint must not be called automatically until the account entitlement and intended credit budget are confirmed. The stocks catalogue is a daily symbol list, not a live mover feed, and cannot by itself identify a current breakout.

Before enabling a live market-wide feed:
1. verify the provider plan/endpoint entitlement with a real, low-risk test;
2. establish the allowable API-credit budget and scan cadence;
3. choose the universe filters (US common stocks, price floor, average dollar volume, market cap/float if licensed);
4. fetch 1-minute or 5-minute bars for a bounded candidate set;
5. persist each alert with provider, source timestamp, detection timestamp, quote age, score components and reason;
6. measure 5-minute, 15-minute, 1-hour and end-of-day outcomes including spread, fees and slippage;
7. show data delay and coverage honestly; never infer a buy/sell instruction or submit an order.

No provider credentials, secrets, Cloudflare configuration, trading functionality or production deployment are changed by this foundation slice.

## DSA publication audit (2026-11-12)

The latest published DSA manifest reports one successful artifact. Inspection of that artifact found only a China A-share market-review report, not a US-equity opportunity report. Its run log shows the default stock list contains only 600519 and records that no LLM model was configured, so AI stock analysis was unavailable in that run. This publication must not be presented as a live US small-cap scanner or as evidence of an actionable breakout feed. Historical reports the user recalls must be retrieved and assessed individually before they are used as training/evaluation examples.

## Candidate data-provider option reviewed (2026-11-12)

Business Quant documents a US market-movers endpoint and 1-minute OHLCV bars for multiple tickers in one request. The movers payload includes per-row quote source and as-of timestamp; the scanner must reject EOD rows when claiming intraday discovery. Its minute-bar volume is cumulative session volume, not per-minute volume, so the adapter must sort oldest-first and difference adjacent cumulative values before calculating VWAP/volume signals. Sources: https://businessquant.com/docs/api/trending and https://businessquant.com/docs/api/quotes-intraday.

The published pricing page lists 30 API calls/day on Free and higher quotas on paid plans; another pricing view shows materially different plan quotas. The account's actual entitlement must be confirmed before selecting a cadence. A three-call scan cycle (movers + minute bars + daily average-volume context) cannot be described as real-time on a 30-call/day allowance. A continuous one-minute scanner needs a higher-throughput plan or a licensed streaming feed. API credentials must remain server-side. Since the current dashboard has no user authentication, provider-data exposure and access control must be reviewed before enabling a paid feed on the public Worker URL.
