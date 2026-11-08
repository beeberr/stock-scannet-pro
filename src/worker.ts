import { analyzeTechnical } from './marketAnalysis.js';
import { analyzeMomentum } from './researchEngines.js';
import { assessLongSetup } from './signalEngine.js';
import { ASSET_UNIVERSE, MAX_TRACKED_ASSETS, DYNAMIC_WATCH_SLOTS, CURRENTLY_CONNECTED_SYMBOLS } from './assetUniverse.js';
import {
  FUTURES_PRODUCTS,
  normalizeFuturesQuote,
  selectFrontContract,
  type FuturesAggregate,
  type FuturesContract
} from './massiveFutures.js';

interface Env {
  TWELVE_DATA_API_KEY?: string;
  MASSIVE_API_KEY?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const ALLOWED_SYMBOLS = new Set(["AAPL", "MSFT", "NVDA", "XLE"]);
const MASSIVE_BASE_URL = "https://api.massive.com";

const EIA_MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
};

function parseEiaWeeklyInventory(html: string) {
  const observations: Array<{ date: string; value: number }> = [];
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(match => match[1].replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim());
    const period = cells[0]?.match(/^(\d{4})-([A-Za-z]{3})$/);
    if (!period || !EIA_MONTHS[period[2]]) continue;
    for (let i = 1; i + 1 < cells.length; i += 2) {
      const day = cells[i].match(/^(\d{2})\/(\d{2})$/);
      const raw = cells[i + 1].replace(/,/g, "");
      const value = Number(raw);
      if (day && raw && Number.isFinite(value)) {
        observations.push({ date: period[1] + "-" + EIA_MONTHS[period[2]] + "-" + day[2], value });
      }
    }
  }
  return observations.sort((a, b) => a.date.localeCompare(b.date));
}

async function massiveJson<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(new URL(path, MASSIVE_BASE_URL), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(12000)
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Massive החזיר תשובה שאינה JSON (HTTP ${response.status})`);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Massive דחה את הבקשה. יש לבדוק שהמפתח תקין ושהחשבון כולל Futures API.");
    }
    if (response.status === 429) {
      throw new Error("הגענו למכסת הבקשות של Massive. הנתונים לא רועננו.");
    }
    throw new Error(`Massive החזיר שגיאת HTTP ${response.status}`);
  }

  const data = payload as { status?: string; error?: string; message?: string };
  if (data?.status === "ERROR" || data?.error) {
    throw new Error(typeof data.message === "string" ? data.message : "Massive החזיר שגיאת נתונים");
  }
  return payload as T;
}

async function fetchMassiveCommodities(apiKey: string) {
  const date = new Date().toISOString().slice(0, 10);
  const contractUrl = new URL("/futures/v1/contracts", MASSIVE_BASE_URL);
  contractUrl.searchParams.set("product_code.any_of", FUTURES_PRODUCTS.map(item => item.productCode).join(","));
  contractUrl.searchParams.set("date", date);
  contractUrl.searchParams.set("active", "true");
  contractUrl.searchParams.set("type", "single");
  contractUrl.searchParams.set("limit", "1000");
  contractUrl.searchParams.set("sort", "product_code.asc");

  const contractsPayload = await massiveJson<{ results?: FuturesContract[] }>(
    contractUrl.pathname + contractUrl.search,
    apiKey
  );
  const contracts = Array.isArray(contractsPayload.results) ? contractsPayload.results : [];

  const entries = await Promise.all(FUTURES_PRODUCTS.map(async product => {
    const contract = selectFrontContract(contracts, product.productCode, 14);
    if (!contract?.ticker) {
      return [product.key, {
        label: product.label,
        productCode: product.productCode,
        exchange: product.exchange,
        available: false,
        source: "Massive Futures",
        error: "לא נמצא חוזה פעיל מתאים. לא נבחר סימול חלופי ולא הומצא מחיר."
      }] as const;
    }

    try {
      const barsUrl = new URL(`/futures/v1/aggs/${encodeURIComponent(contract.ticker)}`, MASSIVE_BASE_URL);
      barsUrl.searchParams.set("resolution", "1session");
      barsUrl.searchParams.set("limit", "80");
      barsUrl.searchParams.set("sort", "window_start.desc");
      const barsPayload = await massiveJson<{ results?: FuturesAggregate[] }>(
        barsUrl.pathname + barsUrl.search,
        apiKey
      );
      const quote = normalizeFuturesQuote(product, contract, Array.isArray(barsPayload.results) ? barsPayload.results : []);
      const history = (quote as typeof quote & { history?: import("./marketAnalysis.js").Candle[] }).history || [];
      if (history.length) {
        const technical = analyzeTechnical(history);
        const momentum = analyzeMomentum(history);
        const previous = history.slice(-21, -1);
        return [product.key, {
          ...quote,
          research: {
            status: technical.status, candles: history.length, asOf: history[history.length - 1].time,
            lastPrice: history[history.length - 1].close,
            technical: { ...technical, support20: previous.length ? Math.min(...previous.map(c => c.low)) : null, resistance20: previous.length ? Math.max(...previous.map(c => c.high)) : null },
            momentum
          }
        }] as const;
      }
      return [product.key, quote] as const;
    } catch (error) {
      return [product.key, {
        label: product.label,
        productCode: product.productCode,
        exchange: product.exchange,
        symbol: contract.ticker,
        available: false,
        source: "Massive Futures",
        error: error instanceof Error ? error.message : "שגיאה בקבלת נתוני החוזה"
      }] as const;
    }
  }));

  return Object.fromEntries(entries);
}

function unavailableCommodities(message: string) {
  return Object.fromEntries(FUTURES_PRODUCTS.map(product => [product.key, {
    label: product.label,
    productCode: product.productCode,
    exchange: product.exchange,
    available: false,
    source: "Massive Futures",
    error: message
  }]));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);


    if (url.pathname === "/api/engines") {
      if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
      const key = env.TWELVE_DATA_API_KEY?.trim();
      if (!key) return Response.json({ error: "מפתח Twelve Data חסר ב-Worker." }, { status: 503 });
      const symbols = (url.searchParams.get("symbols") || "AAPL,MSFT,NVDA,XLE")
        .split(",").map(value => value.trim().toUpperCase()).filter(Boolean);
      if (!symbols.length || symbols.length > 4 || symbols.some(symbol => !ALLOWED_SYMBOLS.has(symbol))) {
        return Response.json({ error: "ניתן לנתח עד ארבעה סימולים מחוברים: AAPL, MSFT, NVDA, XLE." }, { status: 400 });
      }
      const cacheKey = new Request(new URL("/api/engines?provider=twelvedata-v1&symbols=" + symbols.slice().sort().join(","), url.origin), { method: "GET" });
      const edgeCache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;
      try {
        const entries = await Promise.all(symbols.map(async symbol => {
          const upstream = new URL("https://api.twelvedata.com/time_series");
          upstream.searchParams.set("symbol", symbol);
          upstream.searchParams.set("interval", "1day");
          upstream.searchParams.set("outputsize", "80");
          upstream.searchParams.set("order", "ASC");
          upstream.searchParams.set("apikey", key);
          const response = await fetch(upstream, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
          const payload = await response.json() as { status?: string; code?: number; message?: string; values?: Array<Record<string, string>>; meta?: Record<string, unknown> };
          if (!response.ok || payload.status === "error" || payload.code !== undefined || !Array.isArray(payload.values)) {
            throw new Error(symbol + ": " + (payload.message || "Twelve Data לא החזיר היסטוריית OHLCV תקינה"));
          }
          const candles = payload.values.map(row => ({
            time: String(row.datetime || ""),
            open: Number(row.open), high: Number(row.high), low: Number(row.low),
            close: Number(row.close), volume: Number(row.volume ?? 0)
          })).sort((a,b) => Date.parse(a.time) - Date.parse(b.time));
          const technical = analyzeTechnical(candles);
          const latest = candles[candles.length - 1];
          const setup = assessLongSetup(symbol, candles, { equity: 10000, riskPercent: 0.5, rewardRisk: 2 });
          const lookback = candles.slice(-21, -1);
          const resistance = lookback.length ? Math.max(...lookback.map(c => c.high)) : null;
          const support = lookback.length ? Math.min(...lookback.map(c => c.low)) : null;
          const momentumMetrics = analyzeMomentum(candles);
          return [symbol, {
            source: "Twelve Data", interval: "1day", delayedOrLive: "לפי זמינות ומגבלות תוכנית הספק",
            candles: candles.length, asOf: technical.asOf, lastPrice: latest?.close ?? null,
            technical: { ...technical, support20: support, resistance20: resistance },
            momentum: {
              ...momentumMetrics,
              signal: setup.signal, score: setup.score, entryReference: setup.entryReference,
              stopLoss: setup.stopLoss, takeProfit: setup.takeProfit, riskReward: setup.riskReward,
              suggestedQuantity: setup.suggestedQuantity, reasons: setup.reasons
            }
          }] as const;
        }));
        const body = Response.json({
          fetchedAt: new Date().toISOString(), source: "Twelve Data",
          activeEngines: ["technical", "momentum"],
          plannedEngines: ["value", "macro", "gold-oil", "indices-sectors", "news-events", "public-disclosures"],
          data: Object.fromEntries(entries),
          note: "ניתוח טכני ומומנטום מחושבים מנרות יומיים שהתקבלו מהספק. תוצאות הן מחקריות בלבד, אינן תחזית או הוראת מסחר."
        }, { headers: { "Cache-Control": "public, max-age=900, s-maxage=900" } });
        await edgeCache.put(cacheKey, body.clone());
        return body;
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "שגיאה באיסוף נתוני ניתוח", source: "Twelve Data" }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }


    if (url.pathname === "/api/macro") {
      if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
      // Versioned key deliberately bypasses any cached all-or-nothing FRED response.
      const cacheKey = new Request(new URL("/api/macro?provider=fred-v2-independent-series", url.origin), { method: "GET" });
      const edgeCache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;

      const definitions = [
        ["us_10y", "תשואת אג\\"ח ארה\\"ב ל-10 שנים", "%", "DGS10"],
        ["usd_broad", "מדד דולר רחב משוקלל סחר", "מדד", "DTWEXBGS"],
        ["crude_inventory", "מלאי נפט גולמי בארה\\"ב כולל SPR", "אלפי חביות", "WCESTUS1"],
        ["wti_spot", "מחיר ספוט נפט WTI", "דולר לחבית", "DCOILWTICO"],
      ] as const;

      const rows = await Promise.all(definitions.map(async ([key, label, unit, id]) => {
        try {
          const upstream = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
          upstream.searchParams.set("id", id);
          const response = await fetch(upstream, {
            headers: { Accept: "text/csv" },
            signal: AbortSignal.timeout(12000)
          });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const csv = await response.text();
          const lines = csv.trim().split(/\r?\n/);
          if (lines.length < 2 || !/^observation_date,/i.test(lines[0])) {
            throw new Error("FRED החזיר קובץ CSV לא תקין");
          }
          const observations = lines.slice(1).flatMap(line => {
            const parts = line.split(",");
            const date = parts[0]?.replaceAll('"', "");
            const raw = parts[1]?.replaceAll('"', "");
            const value = Number(raw);
            return date && raw && raw !== "." && Number.isFinite(value) ? [{ date, value }] : [];
          }).sort((a, b) => a.date.localeCompare(b.date));
          const latest = observations[observations.length - 1];
          const prior = observations.length > 20 ? observations[observations.length - 21] : observations[0];
          const change = latest && prior ? latest.value - prior.value : null;
          return [key, {
            key, label, unit, seriesId: id,
            status: latest ? (observations.length >= 2 ? "READY" : "INSUFFICIENT_DATA") : "UNAVAILABLE",
            latest: latest?.value ?? null,
            change,
            changePercent: prior && prior.value !== 0 && change !== null ? change / Math.abs(prior.value) * 100 : null,
            asOf: latest?.date ?? null,
            observations: observations.length,
            error: latest ? null : "לא נמצאו תצפיות זמינות בסדרה"
          }] as const;
        } catch (error) {
          // EIA is the primary publisher for WCESTUS1; use its public historical table
          // when the FRED mirror returns an error such as HTTP 404.
          if (id === "WCESTUS1") {
            try {
              const eiaUrl = "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WCESTUS1&f=W";
              const eiaResponse = await fetch(eiaUrl, {
                headers: { Accept: "text/html" },
                signal: AbortSignal.timeout(12000)
              });
              if (!eiaResponse.ok) throw new Error("EIA HTTP " + eiaResponse.status);
              const observations = parseEiaWeeklyInventory(await eiaResponse.text());
              const latest = observations[observations.length - 1];
              const prior = observations.length > 20 ? observations[observations.length - 21] : observations[0];
              const change = latest && prior ? latest.value - prior.value : null;
              if (latest) {
                return [key, {
                  key, label, unit, seriesId: id, source: "EIA",
                  status: observations.length >= 2 ? "READY" : "INSUFFICIENT_DATA",
                  latest: latest.value, change,
                  changePercent: prior && prior.value !== 0 && change !== null ? change / Math.abs(prior.value) * 100 : null,
                  asOf: latest.date, observations: observations.length, error: null
                }] as const;
              }
              throw new Error("לא נמצאו תצפיות בטבלת EIA");
            } catch (fallbackError) {
              return [key, {
                key, label, unit, seriesId: id, status: "UNAVAILABLE",
                latest: null, change: null, changePercent: null, asOf: null, observations: 0,
                error: "FRED " + id + " נכשל; גם EIA לא זמין: " + (fallbackError instanceof Error ? fallbackError.message : "שגיאת ספק")
              }] as const;
            }
          }
          return [key, {
            key, label, unit, seriesId: id, status: "UNAVAILABLE",
            latest: null, change: null, changePercent: null, asOf: null, observations: 0,
            error: "FRED " + id + ": " + (error instanceof Error ? error.message : "שגיאת ספק")
          }] as const;
        }
      }));

      const series = Object.fromEntries(rows);
      const available = rows.filter(([, value]) => value.status === "READY" || value.status === "INSUFFICIENT_DATA").length;
      const response = Response.json({
        source: "Federal Reserve Bank of St. Louis (FRED)",
        fetchedAt: new Date().toISOString(),
        available,
        total: definitions.length,
        series,
        note: "כל סדרה נשלפת ומטופלת בנפרד. כשל בסדרה אחת אינו מונע הצגת סדרות אחרות. ההשוואה היא לתצפית לפני כ-20 פרסומים; תדירות הסדרות שונה."
      }, {
        headers: { "Cache-Control": "public, max-age=600, s-maxage=600" }
      });
      await edgeCache.put(cacheKey, response.clone());
      return response;
    }

    if (url.pathname === "/api/universe") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed." }, { status: 405 });
      }
      return Response.json({
        assets: ASSET_UNIVERSE.map(([symbol, name, category, horizon]) => ({ symbol, name, category, horizon })),
        configuredCount: ASSET_UNIVERSE.length,
        dynamicSlots: DYNAMIC_WATCH_SLOTS,
        maximum: MAX_TRACKED_ASSETS,
        connectedSymbols: CURRENTLY_CONNECTED_SYMBOLS,
        connectedCount: CURRENTLY_CONNECTED_SYMBOLS.length,
        note: "רישום נכסים אינו מעיד על זמינות מחיר. רק connectedSymbols מחוברים כרגע לספק פעיל; יתר הנכסים לא יקבלו מחיר מומצא."
      }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
    }

    if (url.pathname === "/api/health") {
      return Response.json(
        {
          status: "ok",
          version: "2026-11-08-macro-fred-eia-fallback",
          assets: "bound",
          providers: {
            massiveFutures: env.MASSIVE_API_KEY ? "configured" : "missing-key",
            twelveData: env.TWELVE_DATA_API_KEY ? "configured" : "missing-key"
          }
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (url.pathname === "/api/commodities") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed." }, { status: 405 });
      }

      const cacheKey = new Request(new URL("/api/commodities?provider=massive-v1", url.origin), { method: "GET" });
      const edgeCache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;

      if (!env.MASSIVE_API_KEY?.trim()) {
        return Response.json({
          data: unavailableCommodities("מפתח Massive חסר. יש להגדיר MASSIVE_API_KEY כסוד ב-Cloudflare Worker."),
          provider: "Massive Futures",
          providerConfigured: false,
          delay: "מסלול Basic החינמי מספק נתונים היסטוריים בעיכוב של 8 שעות, לא נתוני זמן אמת.",
          fetchedAt: new Date().toISOString(),
          available: 0,
          total: FUTURES_PRODUCTS.length
        }, { headers: { "Cache-Control": "no-store" } });
      }

      try {
        const data = await fetchMassiveCommodities(env.MASSIVE_API_KEY.trim());
        const available = Object.values(data).filter((quote) => (quote as { available?: boolean }).available).length;
        const response = Response.json({
          data,
          provider: "Massive Futures",
          providerConfigured: true,
          planNote: "במסלול Futures Basic החינמי הנתונים היסטוריים בעיכוב של 8 שעות.",
          contractSelection: "החוזה הפעיל הקרוב לפקיעה עם מרווח של 14 ימים לפחות; בחירה זו אינה מבוססת על נפח מסחר.",
          fetchedAt: new Date().toISOString(),
          available,
          total: FUTURES_PRODUCTS.length
        }, {
          headers: { "Cache-Control": "public, max-age=240, s-maxage=240" }
        });
        await edgeCache.put(cacheKey, response.clone());
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "ספק Massive אינו זמין כרגע.";
        return Response.json({
          data: unavailableCommodities(message),
          provider: "Massive Futures",
          providerConfigured: true,
          error: message,
          fetchedAt: new Date().toISOString(),
          available: 0,
          total: FUTURES_PRODUCTS.length
        }, {
          status: 502,
          headers: { "Cache-Control": "no-store" }
        });
      }
    }

    if (url.pathname === "/api/quotes") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed." }, { status: 405 });
      }

      const key = env.TWELVE_DATA_API_KEY?.trim();
      if (!key) {
        return Response.json(
          { error: "Market data secret is missing from this Worker. Add TWELVE_DATA_API_KEY to Worker secrets." },
          { status: 503 }
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
            signal: AbortSignal.timeout(10000)
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
          { headers: { "Cache-Control": "public, max-age=20, s-maxage=20" } }
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Market data provider is temporarily unavailable." },
          { status: 502 }
        );
      }
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const headers = new Headers(assetResponse.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("X-Stock-Scanner-Version", "2026-11-08-macro-fred-eia-fallback");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }
    return assetResponse;
  }
};
