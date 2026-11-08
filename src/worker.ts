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
  FINNHUB_API_KEY?: string;
  FMP_API_KEY?: string;
  EODHD_API_KEY?: string;
  ALPHA_VANTAGE_API_KEY?: string;
  EULERPOOL_API_KEY?: string;
  MARKETSTACK_API_KEY?: string;
  SEC_USER_AGENT?: string;
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
          integratedEngines: ["value", "indices-sectors", "news-events", "public-disclosures"],
          partialEngines: ["macro", "gold-oil"],
          plannedEngines: ["bank-forecast-consensus", "commodity-supply-demand", "political-disclosures"],
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
        ["us_10y", `תשואת אג"ח ארה"ב ל-10 שנים`, "%", "DGS10"],
        ["usd_broad", "מדד דולר רחב משוקלל סחר", "מדד", "DTWEXBGS"],
        ["crude_inventory", `מלאי נפט גולמי בארה"ב כולל SPR`, "אלפי חביות", "WCESTUS1"],
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
            const date = parts[0]?.replace(/\"/g, "");
            const raw = parts[1]?.replace(/\"/g, "");
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


    if (url.pathname === "/api/value") {
      if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
      const key = env.FMP_API_KEY?.trim();
      const eodhdKey = env.EODHD_API_KEY?.trim();
      const eulerpoolKey = env.EULERPOOL_API_KEY?.trim();
      if (!key && !eodhdKey && !eulerpoolKey) return Response.json({ engine: "value", status: "UNAVAILABLE", provider: "FMP/EODHD/Eulerpool", providerConfigured: false, data: {}, error: "לא הוגדר מפתח FMP, EODHD או Eulerpool ב-Worker." }, { headers: { "Cache-Control": "no-store" } });
      const symbols = (url.searchParams.get("symbols") || "AAPL,MSFT,NVDA,JPM").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
      const equitySymbols = new Set<string>(ASSET_UNIVERSE.filter(asset => asset[2] === "מניה").map(asset => asset[0]));
      if (!symbols.length || symbols.length > 8 || symbols.some(symbol => !equitySymbols.has(symbol))) {
        return Response.json({ error: "ניתן לבקש עד שמונה מניות מתוך מאגר המניות." }, { status: 400 });
      }
      const cacheKey = new Request(new URL("/api/value?provider=fmp-stable-v1&symbols=" + symbols.slice().sort().join(","), url.origin), { method: "GET" });
      const edgeCache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;
      const fetchEodhd = async (symbol: string) => {
        const ticker = symbol.replace(".", "-") + ".US";
        const endpoint = new URL("https://eodhd.com/api/v1.1/fundamentals/" + encodeURIComponent(ticker));
        endpoint.searchParams.set("api_token", eodhdKey || "");
        endpoint.searchParams.set("filter", "Highlights,Valuation,Financials::Income_Statement");
        const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("EODHD HTTP " + response.status);
        const payload = await response.json() as Record<string, any>;
        if (!payload || typeof payload !== "object" || payload.Message || payload["Error Message"]) throw new Error("EODHD לא החזיר נתוני יסוד תקינים");
        const highlights = payload.Highlights || {};
        const valuation = payload.Valuation || {};
        const yearly = payload.Financials?.Income_Statement?.yearly || {};
        const reports = Object.values(yearly) as Array<Record<string, unknown>>;
        reports.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
        const latest = reports[0];
        return {
          symbol, status: latest || Object.keys(highlights).length || Object.keys(valuation).length ? "READY" : "UNAVAILABLE",
          source: "EODHD", asOf: String(latest?.date || ""),
          valuation: {
            pe: highlights.PERatio ?? valuation.TrailingPE ?? valuation.TrailingPEttm ?? null,
            priceToBook: valuation.PriceBookMRQ ?? null,
            debtEquity: null, currentRatio: null,
            returnOnEquity: highlights.ReturnOnEquityTTM ?? null,
            netProfitMargin: highlights.ProfitMargin ?? null
          },
          latestFinancials: latest ? {
            date: latest.date ?? null, revenue: latest.totalRevenue ?? null,
            netIncome: latest.netIncome ?? null, operatingIncome: latest.operatingIncome ?? null,
            eps: latest.dilutedEPS ?? latest.basicEPS ?? null
          } : null,
          partial: true
        };
      };
      const fetchEulerpool = async (symbol: string) => {
        if (!eulerpoolKey) throw new Error("Eulerpool key is not configured");
        const endpoint = new URL("https://api.eulerpool.com/api/1/equity/overview/" + encodeURIComponent(symbol));
        const response = await fetch(endpoint, {
          headers: { Accept: "application/json", Authorization: "Bearer " + eulerpoolKey },
          signal: AbortSignal.timeout(15000)
        });
        const payload = await response.json() as Record<string, any>;
        if (!response.ok || !payload || payload.error || (!payload.ticker && !payload.isin)) {
          throw new Error("Eulerpool HTTP " + response.status + " or invalid company overview");
        }
        return {
          symbol, status: "READY", source: "Eulerpool",
          asOf: payload.asOf || payload.updatedAt || null,
          valuation: {
            pe: payload.pe ?? null, priceToBook: payload.pb ?? payload.priceToBook ?? null,
            debtEquity: payload.debtToEquity ?? null, currentRatio: payload.currentRatio ?? null,
            returnOnEquity: payload.roe ?? payload.returnOnEquity ?? null,
            netProfitMargin: payload.netProfitMargin ?? null,
            priceToSales: payload.ps ?? null, dividendYield: payload.dividendYield ?? null,
            fairValueIncome: payload.fairValueIncome ?? null, fairValueRevenue: payload.fairValueRevenue ?? null,
            qualityScore: payload.aaqs ?? null
          },
          latestFinancials: null, partial: true,
          note: "Eulerpool company overview; fields depend on endpoint coverage."
        };
      };
      const fetchBestAvailableFallback = async (symbol: string) => {
        const failures: string[] = [];
        if (eodhdKey) {
          try { return await fetchEodhd(symbol); }
          catch (error) { failures.push("EODHD: " + (error instanceof Error ? error.message : "request failed")); }
        }
        if (eulerpoolKey) {
          try { return await fetchEulerpool(symbol); }
          catch (error) { failures.push("Eulerpool: " + (error instanceof Error ? error.message : "request failed")); }
        }
        throw new Error(failures.join("; ") || "No fundamentals fallback provider configured.");
      };
      const entries = await Promise.all(symbols.map(async symbol => {
        try {
          if (!key) return [symbol, await fetchBestAvailableFallback(symbol)] as const;
          const fetchFmp = async (path: string) => {
            const endpoint = new URL("https://financialmodelingprep.com/stable/" + path);
            endpoint.searchParams.set("symbol", symbol);
            endpoint.searchParams.set("apikey", key || "");
            const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
            if (!response.ok) throw new Error("FMP HTTP " + response.status);
            const payload = await response.json() as unknown;
            if (!Array.isArray(payload) || !payload.length) throw new Error("FMP לא החזיר נתונים זמינים לסימול");
            return payload[0] as Record<string, unknown>;
          };
          const [ratiosResult, statementsResult] = await Promise.allSettled([
            fetchFmp("ratios-ttm"),
            fetchFmp("income-statement?limit=5")
          ]);
          const ratios = ratiosResult.status === "fulfilled" ? ratiosResult.value : null;
          const statement = statementsResult.status === "fulfilled" ? statementsResult.value : null;
          if (!ratios && !statement && (eodhdKey || eulerpoolKey)) return [symbol, await fetchBestAvailableFallback(symbol)] as const;
          const status = ratios || statement ? "READY" : "UNAVAILABLE";
          return [symbol, {
            symbol, status, source: "FMP",
            asOf: String(ratios?.date || statement?.date || ""),
            valuation: ratios ? {
              pe: ratios.priceToEarningsRatioTTM ?? null,
              priceToBook: ratios.priceToBookRatioTTM ?? null,
              debtEquity: ratios.debtEquityRatioTTM ?? null,
              currentRatio: ratios.currentRatioTTM ?? null,
              returnOnEquity: ratios.returnOnEquityTTM ?? null,
              netProfitMargin: ratios.netProfitMarginTTM ?? null
            } : null,
            latestFinancials: statement ? {
              date: statement.date ?? null, revenue: statement.revenue ?? null,
              netIncome: statement.netIncome ?? null, operatingIncome: statement.operatingIncome ?? null,
              eps: statement.eps ?? null
            } : null,
            partial: !ratios || !statement,
            error: !ratios && !statement ? [
              ratiosResult.status === "rejected" ? String(ratiosResult.reason) : "",
              statementsResult.status === "rejected" ? String(statementsResult.reason) : ""
            ].filter(Boolean).join("; ") : null
          }] as const;
        } catch (error) {
          if (eodhdKey || eulerpoolKey) {
            try { return [symbol, await fetchBestAvailableFallback(symbol)] as const; }
            catch (fallbackError) {
              return [symbol, { symbol, status: "UNAVAILABLE", source: "FMP/EODHD/Eulerpool", error: (error instanceof Error ? error.message : "FMP error") + "; " + (fallbackError instanceof Error ? fallbackError.message : "fallback error") }] as const;
            }
          }
          return [symbol, { symbol, status: "UNAVAILABLE", source: "FMP", error: error instanceof Error ? error.message : "שגיאת ספק" }] as const;
        }
      }));
      const data = Object.fromEntries(entries);
      const response = Response.json({
        engine: "value", status: entries.some(([, row]) => row.status === "READY") ? "READY" : "UNAVAILABLE",
        provider: key ? (eodhdKey && eulerpoolKey ? "FMP with EODHD/Eulerpool fallback" : eodhdKey ? "FMP with EODHD fallback" : eulerpoolKey ? "FMP with Eulerpool fallback" : "FMP") : (eodhdKey ? "EODHD" : "Eulerpool"), providerConfigured: true, fetchedAt: new Date().toISOString(), data,
        note: "מדדי הערכת שווי ודוחות פיננסיים בלבד; זמינות השדות תלויה בהרשאות תוכנית FMP. אין לראות בכך המלצת השקעה."
      }, { headers: { "Cache-Control": "public, max-age=21600, s-maxage=21600" } });
      await edgeCache.put(cacheKey, response.clone());
      return response;
    }

    if (url.pathname === "/api/news") {
      if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
      const key = env.FINNHUB_API_KEY?.trim();
      if (!key) return Response.json({ engine: "news-events", status: "UNAVAILABLE", provider: "Finnhub", providerConfigured: false, news: [], earnings: [], error: "מפתח Finnhub אינו מוגדר ב-Worker." }, { headers: { "Cache-Control": "no-store" } });
      const cacheKey = new Request(new URL("/api/news?provider=finnhub-v1", url.origin), { method: "GET" });
      const edgeCache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 86400000);
      const day = (d: Date) => d.toISOString().slice(0, 10);
      const requestFinnhub = async (path: string, params: Record<string, string>) => {
        const endpoint = new URL("https://finnhub.io/api/v1/" + path);
        for (const [name, value] of Object.entries(params)) endpoint.searchParams.set(name, value);
        const response = await fetch(endpoint, { headers: { Accept: "application/json", "X-Finnhub-Token": key }, signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error("Finnhub " + path + " HTTP " + response.status);
        return response.json() as Promise<unknown>;
      };
      const [newsResult, earningsResult] = await Promise.allSettled([
        requestFinnhub("news", { category: "general" }),
        requestFinnhub("calendar/earnings", { from: day(from), to: day(to) })
      ]);
      const news = newsResult.status === "fulfilled" && Array.isArray(newsResult.value) ? newsResult.value.slice(0, 30) : [];
      const earningsPayload = earningsResult.status === "fulfilled" ? earningsResult.value as { earningsCalendar?: unknown[] } : null;
      const earnings = Array.isArray(earningsPayload?.earningsCalendar) ? earningsPayload.earningsCalendar.slice(0, 30) : [];
      const status = news.length || earnings.length ? "READY" : "UNAVAILABLE";
      const response = Response.json({
        engine: "news-events", status, provider: "Finnhub", providerConfigured: true,
        fetchedAt: new Date().toISOString(), news, earnings,
        errors: {
          news: newsResult.status === "rejected" ? String(newsResult.reason) : null,
          earnings: earningsResult.status === "rejected" ? String(earningsResult.reason) : null
        },
        note: "חדשות ולוח דוחות; היקף ההיסטוריה, הכיסוי והשימוש תלויים בתוכנית Finnhub וברישיון."
      }, { headers: { "Cache-Control": "public, max-age=900, s-maxage=900" } });
      if (status === "READY") await edgeCache.put(cacheKey, response.clone());
      return response;
    }

    if (url.pathname === "/api/disclosures") {
      if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
      const symbols = (url.searchParams.get("symbols") || "AAPL,MSFT,NVDA").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
      const equitySymbols = new Set<string>(ASSET_UNIVERSE.filter(asset => asset[2] === "מניה").map(asset => asset[0]));
      if (!symbols.length || symbols.length > 5 || symbols.some(symbol => !equitySymbols.has(symbol))) {
        return Response.json({ error: "ניתן לבקש עד חמש מניות מתוך מאגר המניות." }, { status: 400 });
      }
      if (!env.SEC_USER_AGENT?.trim()) {
        const finnhubKey = env.FINNHUB_API_KEY?.trim();
        if (finnhubKey) {
          const to = new Date();
          const from = new Date(to.getTime() - 90 * 86400000);
          const day = (d: Date) => d.toISOString().slice(0, 10);
          const entries = await Promise.all(symbols.map(async symbol => {
            try {
              const endpoint = new URL("https://finnhub.io/api/v1/stock/filings");
              endpoint.searchParams.set("symbol", symbol);
              endpoint.searchParams.set("from", day(from));
              endpoint.searchParams.set("to", day(to));
              const response = await fetch(endpoint, { headers: { Accept: "application/json", "X-Finnhub-Token": finnhubKey }, signal: AbortSignal.timeout(12000) });
              if (!response.ok) throw new Error("Finnhub filings HTTP " + response.status);
              const payload = await response.json() as unknown;
              const filings = Array.isArray(payload) ? payload.slice(0, 20) : [];
              return [symbol, { symbol, status: filings.length ? "READY" : "NO_RECENT_MATCHES", source: "Finnhub filings", filings }] as const;
            } catch (error) {
              return [symbol, { symbol, status: "UNAVAILABLE", source: "Finnhub filings", error: error instanceof Error ? error.message : "שגיאת ספק" }] as const;
            }
          }));
          const data = Object.fromEntries(entries);
          return Response.json({
            engine: "public-disclosures",
            status: entries.some(([, row]) => row.status === "READY") ? "READY" : "UNAVAILABLE",
            provider: "Finnhub filings", providerConfigured: true, fetchedAt: new Date().toISOString(), data,
            note: "מוצגים דיווחי חברות כפי שסופקו על ידי Finnhub. לחיבור ישיר למקור SEC EDGAR יש להגדיר SEC_USER_AGENT תקין. אין כאן גילויי עסקאות של נבחרי ציבור."
          }, { headers: { "Cache-Control": "public, max-age=1800, s-maxage=1800" } });
        }
        return Response.json({
          engine: "public-disclosures", status: "UNAVAILABLE", provider: "SEC EDGAR",
          providerConfigured: false, data: {},
          error: "חסר SEC_USER_AGENT וגם לא הוגדר מפתח Finnhub לשימוש כחלופה."
        }, { headers: { "Cache-Control": "no-store" } });
      }
      const cacheKey = new Request(new URL("/api/disclosures?provider=sec-edgar-v1&symbols=" + symbols.slice().sort().join(","), url.origin), { method: "GET" });
      const edgeCache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;
      try {
        const headers = { Accept: "application/json", "User-Agent": env.SEC_USER_AGENT.trim() };
        const tickerResponse = await fetch("https://www.sec.gov/files/company_tickers.json", { headers, signal: AbortSignal.timeout(12000) });
        if (!tickerResponse.ok) throw new Error("SEC ticker directory HTTP " + tickerResponse.status);
        const tickerPayload = await tickerResponse.json() as Record<string, { cik_str: number; ticker: string; title: string }>;
        const tickerRows = Object.values(tickerPayload);
        const entries = await Promise.all(symbols.map(async symbol => {
          const company = tickerRows.find(row => row.ticker.toUpperCase() === symbol);
          if (!company) return [symbol, { symbol, status: "UNAVAILABLE", error: "הסימול לא נמצא במפתח החברות של SEC." }] as const;
          const cik = String(company.cik_str).padStart(10, "0");
          try {
            const response = await fetch("https://data.sec.gov/submissions/CIK" + cik + ".json", { headers, signal: AbortSignal.timeout(12000) });
            if (!response.ok) throw new Error("SEC submissions HTTP " + response.status);
            const payload = await response.json() as { filings?: { recent?: Record<string, unknown[]> } };
            const recent = payload.filings?.recent || {};
            const forms = Array.isArray(recent.form) ? recent.form as string[] : [];
            const dates = Array.isArray(recent.filingDate) ? recent.filingDate as string[] : [];
            const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber as string[] : [];
            const documents = Array.isArray(recent.primaryDocument) ? recent.primaryDocument as string[] : [];
            const items = forms.flatMap((form, index) => {
              if (!["4", "4/A", "8-K", "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"].includes(form)) return [];
              const accession = accessions[index];
              const document = documents[index];
              if (!accession || !document) return [];
              return [{
                form, filingDate: dates[index] || null, accessionNumber: accession,
                company: company.title,
                url: "https://www.sec.gov/Archives/edgar/data/" + company.cik_str + "/" + accession.replace(/-/g, "") + "/" + document
              }];
            }).slice(0, 20);
            return [symbol, { symbol, company: company.title, cik: company.cik_str, status: items.length ? "READY" : "NO_RECENT_MATCHES", source: "SEC EDGAR", filings: items }] as const;
          } catch (error) {
            return [symbol, { symbol, status: "UNAVAILABLE", error: error instanceof Error ? error.message : "SEC request failed" }] as const;
          }
        }));
        const data = Object.fromEntries(entries);
        const response = Response.json({
          engine: "public-disclosures",
          status: entries.some(([, row]) => row.status === "READY") ? "READY" : "UNAVAILABLE",
          provider: "SEC EDGAR", providerConfigured: true, fetchedAt: new Date().toISOString(), data,
          note: "SEC EDGAR מכסה דיווחי חברות ובעלי עניין כגון Form 4; הוא אינו מאגר גילויי עסקאות של נבחרי ציבור לפי STOCK Act."
        }, { headers: { "Cache-Control": "public, max-age=1800, s-maxage=1800" } });
        await edgeCache.put(cacheKey, response.clone());
        return response;
      } catch (error) {
        return Response.json({
          engine: "public-disclosures", status: "UNAVAILABLE", provider: "SEC EDGAR",
          providerConfigured: true, data: {},
          error: error instanceof Error ? error.message : "SEC EDGAR אינו זמין כרגע."
        }, { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }

    if (url.pathname === "/api/indices") {
      if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
      const key = env.FMP_API_KEY?.trim();
      const marketstackKey = env.MARKETSTACK_API_KEY?.trim();
      if (!key && !marketstackKey) return Response.json({ engine: "indices-sectors", status: "UNAVAILABLE", provider: "FMP/Marketstack", providerConfigured: false, data: {}, error: "לא הוגדר מפתח FMP או Marketstack ב-Worker." }, { headers: { "Cache-Control": "no-store" } });
      const symbols = ["SPY", "QQQ", "DIA", "IWM", "XLF", "XLK", "XLE", "XLV", "XLI", "XLY", "XLP"];
      const cacheKey = new Request(new URL("/api/indices?provider=fmp-marketstack-eod-v2", url.origin), { method: "GET" });
      const edgeCache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;
      const fetchMarketstack = async (symbol: string) => {
        if (!marketstackKey) throw new Error("Marketstack אינו מוגדר");
        const endpoint = new URL("https://api.marketstack.com/v2/eod/latest");
        endpoint.searchParams.set("symbols", symbol);
        endpoint.searchParams.set("access_key", marketstackKey);
        const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
        const payload = await response.json() as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
        const row = Array.isArray(payload.data) ? payload.data.find(item => String(item.symbol || "").toUpperCase() === symbol) || payload.data[0] : null;
        const close = Number(row?.close);
        if (!response.ok || !row || !Number.isFinite(close) || close <= 0) {
          throw new Error("Marketstack HTTP " + response.status + (payload.error?.message ? ": " + payload.error.message : " או נתון סגירה חסר"));
        }
        return { symbol, price: close, name: symbol, asOf: row.date ?? null, source: "Marketstack EOD", delayed: true, status: "READY" };
      };
      const entries = await Promise.all(symbols.map(async symbol => {
        let fmpFailure = "";
        if (key) {
          try {
            const endpoint = new URL("https://financialmodelingprep.com/stable/quote");
            endpoint.searchParams.set("symbol", symbol);
            endpoint.searchParams.set("apikey", key);
            const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
            if (!response.ok) throw new Error("FMP HTTP " + response.status);
            const payload = await response.json() as Array<Record<string, unknown>>;
            const quote = Array.isArray(payload) ? payload[0] : null;
            if (!quote || quote.price === undefined) throw new Error("FMP לא החזיר ציטוט תקין");
            return [symbol, { symbol, price: quote.price, change: quote.change, changesPercentage: quote.changePercentage, volume: quote.volume, name: quote.name, asOf: quote.timestamp ?? null, source: "FMP", status: "READY" }] as const;
          } catch (error) {
            fmpFailure = error instanceof Error ? error.message : "FMP request failed";
          }
        }
        if (marketstackKey) {
          try {
            const fallback = await fetchMarketstack(symbol);
            return [symbol, { ...fallback, fallbackFrom: key ? "FMP" : null, fallbackReason: fmpFailure || null }] as const;
          } catch (error) {
            const fallbackFailure = error instanceof Error ? error.message : "Marketstack request failed";
            return [symbol, { symbol, status: "UNAVAILABLE", source: key ? "FMP/Marketstack" : "Marketstack", error: [fmpFailure, fallbackFailure].filter(Boolean).join("; ") }] as const;
          }
        }
        return [symbol, { symbol, status: "UNAVAILABLE", source: "FMP", error: fmpFailure || "FMP לא החזיר נתון" }] as const;
      }));
      const data = Object.fromEntries(entries);
      const ready = entries.filter(([, row]) => row.status === "READY").length;
      const sources = [...new Set(entries.map(([, row]) => row.source).filter(Boolean))];
      const response = Response.json({
        engine: "indices-sectors", status: ready ? "READY" : "UNAVAILABLE",
        provider: sources.join(" + ") || "FMP/Marketstack", providerConfigured: true,
        available: ready, total: symbols.length, fetchedAt: new Date().toISOString(), data,
        note: "ETF-ים משמשים כפרוקסי למדדים ולסקטורים. Marketstack מספק כאן נתוני סגירה יומיים בלבד, לא נתוני זמן אמת ולא מדידת רוחב שוק מלאה."
      }, { headers: { "Cache-Control": "public, max-age=900, s-maxage=900" } });
      if (response.ok) await edgeCache.put(cacheKey, response.clone());
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
          version: "2026-11-08-multi-provider-engines",
          assets: "bound",
          providers: {
            massiveFutures: env.MASSIVE_API_KEY ? "configured" : "missing-key",
            twelveData: env.TWELVE_DATA_API_KEY ? "configured" : "missing-key",
            finnhub: env.FINNHUB_API_KEY ? "configured" : "missing-key",
            fmp: env.FMP_API_KEY ? "configured" : "missing-key",
            eodhd: env.EODHD_API_KEY ? "configured" : "missing-key",
            alphaVantage: env.ALPHA_VANTAGE_API_KEY ? "configured" : "missing-key",
            eulerpool: env.EULERPOOL_API_KEY ? "configured" : "missing-key",
            marketstack: env.MARKETSTACK_API_KEY ? "configured" : "missing-key",
            secEdgar: env.SEC_USER_AGENT ? "configured" : "missing-user-agent"
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

      const twelveKey = env.TWELVE_DATA_API_KEY?.trim();
      const alphaKey = env.ALPHA_VANTAGE_API_KEY?.trim();
      const marketstackKey = env.MARKETSTACK_API_KEY?.trim();
      if (!twelveKey && !alphaKey && !marketstackKey) {
        return Response.json(
          { error: "חסרים מפתחות TWELVE_DATA_API_KEY ו-ALPHA_VANTAGE_API_KEY ב-Worker." },
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

      const cacheKey = new Request(new URL("/api/quotes?provider=twelve-alpha-v1&symbols=" + symbols.slice().sort().join(","), url.origin), { method: "GET" });
      const edgeCache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;

      const fetchTwelveData = async (symbol: string) => {
        if (!twelveKey) throw new Error("Twelve Data key is not configured");
        const upstream = new URL("https://api.twelvedata.com/quote");
        upstream.searchParams.set("symbol", symbol);
        upstream.searchParams.set("apikey", twelveKey);
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
        return { ...data, source: "Twelve Data" };
      };

      const fetchAlphaVantage = async (symbol: string) => {
        if (!alphaKey) throw new Error("Alpha Vantage key is not configured");
        const upstream = new URL("https://www.alphavantage.co/query");
        upstream.searchParams.set("function", "GLOBAL_QUOTE");
        upstream.searchParams.set("symbol", symbol);
        upstream.searchParams.set("apikey", alphaKey);
        const response = await fetch(upstream, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(12000)
        });
        const payload = await response.json() as Record<string, any>;
        const quote = payload["Global Quote"] as Record<string, string> | undefined;
        if (!response.ok || !quote || !quote["05. price"]) {
          const reason = payload.Note || payload.Information || payload["Error Message"] || "Alpha Vantage did not return a valid global quote";
          throw new Error(symbol + ": " + String(reason));
        }
        const price = Number(quote["05. price"]);
        const change = Number(quote["09. change"]);
        const percentChange = Number(String(quote["10. change percent"] || "").replace("%", ""));
        if (![price, change, percentChange].every(Number.isFinite)) {
          throw new Error(symbol + ": Alpha Vantage returned non-numeric quote fields");
        }
        return {
          symbol,
          close: price,
          price,
          change,
          percent_change: String(percentChange),
          datetime: quote["07. latest trading day"] || null,
          source: "Alpha Vantage"
        };
      };

      const fetchMarketstack = async (symbol: string) => {
        if (!marketstackKey) throw new Error("Marketstack key is not configured");
        const endpoint = new URL("https://api.marketstack.com/v2/eod/latest");
        endpoint.searchParams.set("symbols", symbol);
        endpoint.searchParams.set("access_key", marketstackKey);
        const response = await fetch(endpoint, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(12000)
        });
        const payload = await response.json() as { data?: Array<Record<string, unknown>>; error?: { message?: string; code?: string } };
        if (!response.ok || payload.error || !Array.isArray(payload.data)) {
          throw new Error(symbol + ": " + (payload.error?.message || "Marketstack did not return EOD data"));
        }
        const row = payload.data.find(item => String(item.symbol || "").toUpperCase() === symbol) || payload.data[0];
        const close = Number(row?.close);
        if (!row || !Number.isFinite(close) || close <= 0) {
          throw new Error(symbol + ": Marketstack returned no valid closing price");
        }
        return {
          symbol, close, price: close,
          open: row.open ?? null, high: row.high ?? null, low: row.low ?? null,
          volume: row.volume ?? null, datetime: row.date ?? null,
          source: "Marketstack EOD",
          delayedOrLive: "נתון סגירה יומי; אינו מחיר תוך-יומי או זמן אמת"
        };
      };

      const entries = await Promise.all(symbols.map(async symbol => {
        const failures: string[] = [];
        if (twelveKey) {
          try { return [symbol, await fetchTwelveData(symbol)] as const; }
          catch (error) { failures.push("Twelve Data: " + (error instanceof Error ? error.message : "request failed")); }
        }
        if (alphaKey) {
          try {
            const fallback = await fetchAlphaVantage(symbol);
            return [symbol, { ...fallback, fallbackFrom: twelveKey ? "Twelve Data" : null, fallbackReason: failures[0] || null }] as const;
          } catch (error) { failures.push("Alpha Vantage: " + (error instanceof Error ? error.message : "request failed")); }
        }
        if (marketstackKey) {
          try {
            const fallback = await fetchMarketstack(symbol);
            return [symbol, { ...fallback, fallbackFrom: failures.length ? failures.map(item => item.split(":")[0]).join(" + ") : null, fallbackReason: failures.join("; ") || null }] as const;
          } catch (error) { failures.push("Marketstack: " + (error instanceof Error ? error.message : "request failed")); }
        }
        return [symbol, {
          symbol, status: "UNAVAILABLE",
          source: [twelveKey && "Twelve Data", alphaKey && "Alpha Vantage", marketstackKey && "Marketstack"].filter(Boolean).join("/") || "No quote provider",
          error: failures.join("; ") || "No configured quote provider returned data."
        }] as const;
      }));

      const data = Object.fromEntries(entries);
      const available = entries.filter(([, row]) => !("status" in row) || row.status !== "UNAVAILABLE").length;
      const sources = [...new Set(entries.map(([, row]) => row.source).filter(Boolean))];
      const response = Response.json({
        data,
        fetchedAt: new Date().toISOString(),
        source: sources.length === 1 ? sources[0] : sources.join(" + ") || "Twelve Data/Alpha Vantage",
        providerConfigured: { twelveData: Boolean(twelveKey), alphaVantage: Boolean(alphaKey), marketstack: Boolean(marketstackKey) },
        available,
        total: symbols.length,
        note: "Twelve Data הוא המקור הראשי; Alpha Vantage משמש כגיבוי רק כאשר המקור הראשי נכשל. זמני המסחר, עיכובים ומכסות תלויים בתוכנית הספק."
      }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
      await edgeCache.put(cacheKey, response.clone());
      return response;
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const headers = new Headers(assetResponse.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("X-Stock-Scanner-Version", "2026-11-08-multi-provider-engines");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }
    return assetResponse;
  }
};
