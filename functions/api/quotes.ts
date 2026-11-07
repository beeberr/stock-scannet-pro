interface Env {
  TWELVE_DATA_API_KEY?: string;
}

const ALLOWED_SYMBOLS = new Set(["AAPL", "MSFT", "NVDA", "XLE"]);

export const onRequestGet = async ({ request, env }: {
  request: Request;
  env: Env;
}) => {
  const key = env.TWELVE_DATA_API_KEY;
  if (!key) {
    return Response.json({ error: "Market data is not configured on the server." }, { status: 503 });
  }

  const url = new URL(request.url);
  const requested = (url.searchParams.get("symbols") || "AAPL,MSFT,NVDA,XLE")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (!requested.length || requested.length > 8 || requested.some((symbol) => !ALLOWED_SYMBOLS.has(symbol))) {
    return Response.json({ error: "Unsupported or invalid symbols." }, { status: 400 });
  }

  const upstream = new URL("https://api.twelvedata.com/quote");
  upstream.searchParams.set("symbol", requested.join(","));
  upstream.searchParams.set("apikey", key);

  try {
    const response = await fetch(upstream.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      return Response.json({ error: "Market data provider request failed.", providerStatus: response.status }, { status: 502 });
    }
    return Response.json({ data, fetchedAt: new Date().toISOString(), source: "Twelve Data" }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=30" },
    });
  } catch {
    return Response.json({ error: "Market data provider is temporarily unavailable." }, { status: 502 });
  }
};
