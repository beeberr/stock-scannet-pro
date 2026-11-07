interface Env {
  TWELVE_DATA_API_KEY?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const ALLOWED_SYMBOLS = new Set(["AAPL", "MSFT", "NVDA", "XLE"]);

const COMMODITIES = [
  { key: "GC", label: "זהב", symbol: "GC=F" },
  { key: "HG", label: "נחושת", symbol: "HG=F" },
  { key: "CL", label: "נפט WTI", symbol: "CL=F" },
  { key: "KC", label: "קפה", symbol: "KC=F" },
  { key: "CC", label: "קקאו", symbol: "CC=F" },
] as const;

async function fetchYahooCommodity(item: (typeof COMMODITIES)[number]) {
  const encoded = encodeURIComponent(item.symbol);
  let lastError = "ספק הנתונים לא החזיר מחיר";
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const upstream = new URL(`https://${host}/v8/finance/chart/${encoded}`);
      upstream.searchParams.set("range", "5d");
      upstream.searchParams.set("interval", "1d");
      const response = await fetch(upstream, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; StockScannerPro/1.0)",
        },
        signal: AbortSignal.timeout(12000),
      });
      const payload = await response.json() as {
        chart?: {
          result?: Array<{ meta?: Record<string, any> }>;
          error?: { description?: string } | null;
        };
      };
      const meta = payload.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice ?? meta?.previousClose);
      const previous = Number(meta?.chartPreviousClose ?? meta?.previousClose);
      if (!response.ok || !Number.isFinite(price) || price <= 0) {
        lastError = payload.chart?.error?.description || `Yahoo Finance החזיר HTTP ${response.status}`;
        continue;
      }
      const change = Number.isFinite(previous) && previous > 0 ? price - previous : null;
      const percent = change !== null && previous > 0 ? (change / previous) * 100 : null;
      return [item.key, {
        label: item.label,
        symbol: item.symbol,
        name: meta?.shortName || meta?.longName || item.label,
        price: String(price),
        close: String(price),
        previous_close: Number.isFinite(previous) ? String(previous) : undefined,
        change: change === null ? undefined : change.toFixed(6),
        percent_change: percent === null ? undefined : percent.toFixed(4),
        currency: meta?.currency || "USD",
        exchange: meta?.fullExchangeName || meta?.exchangeName || "Futures",
        datetime: meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : undefined,
        available: true,
        delayed: true,
        source: "Yahoo Finance",
      }] as const;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "שגיאת חיבור לספק הנתונים";
    }
  }
  return [item.key, {
    label: item.label,
    symbol: item.symbol,
    available: false,
    error: lastError,
    source: "Yahoo Finance",
  }] as const;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json(
        { status: "ok", version: "2026-11-08-yahoo-commodities", assets: "bound" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (url.pathname === "/api/commodities") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed." }, { status: 405 });
      }
      const results = await Promise.all(COMMODITIES.map(fetchYahooCommodity));
      const available = results.filter(([, quote]) => quote.available).length;
      return Response.json(
        {
          data: Object.fromEntries(results),
          fetchedAt: new Date().toISOString(),
          source: "Yahoo Finance (futures; delayed quotes)",
          available,
          total: COMMODITIES.length,
        },
        { headers: { "Cache-Control": "public, max-age=30, s-maxage=30" } },
      );
    }

    if (url.pathname === "/api/quotes") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed." }, { status: 405 });
      }

      const key = env.TWELVE_DATA_API_KEY?.trim();
      if (!key) {
        return Response.json(
          { error: "Market data secret is missing from this Worker. Add TWELVE_DATA_API_KEY to Worker secrets." },
          { status: 503 },
        );
      }

      const symbols = (url.searchParams.get("symbols") || "AAPL,MSFT,NVDA,XLE")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);

      if (!symbols.length || symbols.length > 8 || symbols.some((symbol) => !ALLOWED_SYMBOLS.has(symbol))) {
        return Response.json({ error: "Unsupported or invalid symbols." }, { status: 400 });
      }

      try {
        const entries = await Promise.all(symbols.map(async (symbol) => {
          const upstream = new URL("https://api.twelvedata.com/quote");
          upstream.searchParams.set("symbol", symbol);
          upstream.searchParams.set("apikey", key);

          const response = await fetch(upstream, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10000),
          });
          const data = await response.json() as Record<string, unknown>;

          if (!response.ok || data.status === "error" || data.code !== undefined) {
            const message = typeof data.message === "string" ? data.message : "Market data provider request failed.";
            throw new Error(symbol + ": " + message);
          }
          if (typeof data.symbol !== "string" || data.close === undefined) {
            throw new Error(symbol + ": provider returned an incomplete quote.");
          }
          return [symbol, data] as const;
        }));

        return Response.json(
          { data: Object.fromEntries(entries), fetchedAt: new Date().toISOString(), source: "Twelve Data" },
          { headers: { "Cache-Control": "public, max-age=20, s-maxage=20" } },
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Market data provider is temporarily unavailable." },
          { status: 502 },
        );
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const headers = new Headers(assetResponse.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("X-Stock-Scanner-Version", "2026-11-08-yahoo-commodities");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    }
    return assetResponse;
  },
};
