interface Env {
  TWELVE_DATA_API_KEY?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const ALLOWED_SYMBOLS = new Set(["AAPL", "MSFT", "NVDA", "XLE"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json(
        { status: "ok", version: "2026-11-08-cache-check", assets: "bound" },
        { headers: { "Cache-Control": "no-store" } },
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
      headers.set("X-Stock-Scanner-Version", "2026-11-08-cache-check");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    }
    return assetResponse;
  },
};
