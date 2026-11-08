interface Env {
  TWELVE_DATA_API_KEY?: string;
  ALPACA_API_KEY_ID?: string;
  ALPACA_API_SECRET_KEY?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const ALLOWED_SYMBOLS = new Set(["AAPL", "MSFT", "NVDA", "XLE"]);
const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "XLE"] as const;

const COMMODITIES = [
  { key: "GC", label: "זהב", symbol: "GC=F" },
  { key: "HG", label: "נחושת", symbol: "HG=F" },
  { key: "CL", label: "נפט WTI", symbol: "CL=F" },
  { key: "KC", label: "קפה", symbol: "KC=F" },
  { key: "CC", label: "קקאו", symbol: "CC=F" },
] as const;

type QuoteResult = Record<string, unknown> & {
  symbol: string;
  close: string;
  source: string;
  available: true;
  datetime?: string;
};

async function fetchTwelveQuote(symbol: string, key: string): Promise<QuoteResult> {
  const upstream = new URL("https://api.twelvedata.com/quote");
  upstream.searchParams.set("symbol", symbol);
  upstream.searchParams.set("apikey", key);
  const response = await fetch(upstream, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok || data.status === "error" || data.code !== undefined) {
    throw new Error(typeof data.message === "string" ? data.message : `Twelve Data HTTP ${response.status}`);
  }
  const close = Number(data.close);
  if (data.symbol !== symbol || !Number.isFinite(close) || close <= 0) {
    throw new Error("Twelve Data returned an incomplete or invalid quote.");
  }
  return { ...data, symbol, close: String(close), source: "Twelve Data", available: true };
}

async function fetchAlpacaQuote(symbol: string, keyId: string, secret: string): Promise<QuoteResult> {
  const upstream = new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/snapshot`);
  upstream.searchParams.set("feed", "iex");
  const response = await fetch(upstream, {
    headers: {
      Accept: "application/json",
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secret,
    },
    signal: AbortSignal.timeout(10000),
  });
  const snapshot = await response.json() as {
    latestTrade?: { p?: number; t?: string };
    dailyBar?: { c?: number };
    prevDailyBar?: { c?: number };
  };
  if (!response.ok) throw new Error(`Alpaca IEX HTTP ${response.status}`);
  const price = Number(snapshot.latestTrade?.p ?? snapshot.dailyBar?.c);
  const previous = Number(snapshot.prevDailyBar?.c);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Alpaca returned no valid IEX trade price.");
  const change = Number.isFinite(previous) && previous > 0 ? price - previous : null;
  const percent = change !== null ? change / previous * 100 : null;
  return {
    symbol,
    name: symbol,
    close: String(price),
    price: String(price),
    previous_close: Number.isFinite(previous) ? String(previous) : undefined,
    change: change === null ? undefined : change.toFixed(6),
    percent_change: percent === null ? undefined : percent.toFixed(4),
    datetime: snapshot.latestTrade?.t,
    source: "Alpaca IEX",
    feed: "iex",
    available: true,
    delayed: false,
  };
}

async function fetchQuoteWithFallback(symbol: string, env: Env) {
  const errors: string[] = [];
  if (env.TWELVE_DATA_API_KEY?.trim()) {
    try {
      return await fetchTwelveQuote(symbol, env.TWELVE_DATA_API_KEY.trim());
    } catch (error) {
      errors.push("Twelve Data: " + (error instanceof Error ? error.message : "request failed"));
    }
  }
  if (env.ALPACA_API_KEY_ID?.trim() && env.ALPACA_API_SECRET_KEY?.trim()) {
    try {
      return await fetchAlpacaQuote(symbol, env.ALPACA_API_KEY_ID.trim(), env.ALPACA_API_SECRET_KEY.trim());
    } catch (error) {
      errors.push("Alpaca IEX: " + (error instanceof Error ? error.message : "request failed"));
    }
  }
  return {
    symbol,
    available: false,
    error: errors.join(" | ") || "No market-data provider credentials are configured.",
    source: null,
  };
}

async function fetchYahooCommodity(item: (typeof COMMODITIES)[number]) {
  const encoded = encodeURIComponent(item.symbol);
  let lastError = "ספק הנתונים לא החזיר מחיר";
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const upstream = new URL(`https://${host}/v8/finance/chart/${encoded}`);
      upstream.searchParams.set("range", "5d");
      upstream.searchParams.set("interval", "1d");
      const response = await fetch(upstream, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; StockScannerPro/1.0)" },
        signal: AbortSignal.timeout(12000),
      });
      const payload = await response.json() as {
        chart?: { result?: Array<{ meta?: Record<string, unknown> }>; error?: { description?: string } | null };
      };
      const meta = payload.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice ?? meta?.previousClose);
      const previous = Number(meta?.chartPreviousClose ?? meta?.previousClose);
      if (!response.ok || !Number.isFinite(price) || price <= 0) {
        lastError = payload.chart?.error?.description || `Yahoo Finance HTTP ${response.status}`;
        continue;
      }
      const change = Number.isFinite(previous) && previous > 0 ? price - previous : null;
      const percent = change !== null && previous > 0 ? change / previous * 100 : null;
      return [item.key, {
        label: item.label, symbol: item.symbol,
        name: meta?.shortName || meta?.longName || item.label,
        price: String(price), close: String(price),
        previous_close: Number.isFinite(previous) ? String(previous) : undefined,
        change: change === null ? undefined : change.toFixed(6),
        percent_change: percent === null ? undefined : percent.toFixed(4),
        currency: meta?.currency || "USD",
        exchange: meta?.fullExchangeName || meta?.exchangeName || "Futures",
        datetime: meta?.regularMarketTime ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : undefined,
        available: true, delayed: true, source: "Yahoo Finance",
      }] as const;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "שגיאת חיבור לספק הנתונים";
    }
  }
  return [item.key, { label: item.label, symbol: item.symbol, available: false, error: lastError, source: "Yahoo Finance" }] as const;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json(
        { status: "ok", version: "2026-11-08-multi-provider", assets: "bound" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (url.pathname === "/api/providers") {
      return Response.json({
        providers: {
          twelveData: { configured: Boolean(env.TWELVE_DATA_API_KEY?.trim()), role: "primary" },
          alpacaIex: {
            configured: Boolean(env.ALPACA_API_KEY_ID?.trim() && env.ALPACA_API_SECRET_KEY?.trim()),
            role: "automatic-fallback",
            feed: "IEX",
          },
          yahooFinance: { configured: true, role: "commodities-fallback", caveat: "Unofficial endpoint; verify terms and data freshness." },
        },
        usage: "Private single-user research workspace. Provider terms and personal-use permissions must still be checked individually.",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/api/commodities") {
      if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
      const results = await Promise.all(COMMODITIES.map(fetchYahooCommodity));
      const available = results.filter(([, quote]) => quote.available).length;
      return Response.json({
        data: Object.fromEntries(results), fetchedAt: new Date().toISOString(),
        source: "Yahoo Finance (futures; delayed quotes)", available, total: COMMODITIES.length,
      }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=30" } });
    }

    if (url.pathname === "/api/quotes") {
      if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
      const symbols = (url.searchParams.get("symbols") || DEFAULT_SYMBOLS.join(","))
        .split(",").map(symbol => symbol.trim().toUpperCase()).filter(Boolean);
      if (!symbols.length || symbols.length > 8 || symbols.some(symbol => !ALLOWED_SYMBOLS.has(symbol))) {
        return Response.json({ error: "Unsupported or invalid symbols." }, { status: 400 });
      }
      const entries = await Promise.all(symbols.map(async symbol => [symbol, await fetchQuoteWithFallback(symbol, env)] as const));
      const data = Object.fromEntries(entries);
      const available = entries.filter(([, quote]) => quote.available).length;
      const sources = [...new Set(entries.map(([, quote]) => quote.source).filter(Boolean))];
      return Response.json(
        { data, fetchedAt: new Date().toISOString(), sources, available, total: symbols.length },
        { headers: { "Cache-Control": "public, max-age=15, s-maxage=15" } },
      );
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const headers = new Headers(assetResponse.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("X-Stock-Scanner-Version", "2026-11-08-multi-provider");
      return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    }
    return assetResponse;
  },
};
