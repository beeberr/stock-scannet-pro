export interface MacroObservation { date: string; value: number }
export interface MacroSeries { key: string; label: string; unit: string; observations: MacroObservation[] }
export function parseFredCsv(csv: string): MacroObservation[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  return lines.slice(1).flatMap(line => {
    const parts = line.split(",");
    const date = parts[0]?.replace(/^\"|\"$/g, "");
    const raw = parts[1]?.replace(/^\"|\"$/g, "");
    const value = Number(raw);
    return date && raw && raw !== "." && Number.isFinite(value) ? [{ date, value }] : [];
  }).sort((x,y)=>x.date.localeCompare(y.date));
}
export function summarizeMacroSeries(series: MacroSeries) {
  const rows = series.observations;
  const latest = rows.at(-1);
  const prior = rows.length > 20 ? rows[rows.length - 21] : rows[0];
  if (!latest) return { key: series.key, label: series.label, unit: series.unit, status: "UNAVAILABLE", latest: null, change: null, changePercent: null, asOf: null, observations: 0 };
  const change = prior ? latest.value - prior.value : null;
  return { key: series.key, label: series.label, unit: series.unit, status: rows.length >= 2 ? "READY" : "INSUFFICIENT_DATA", latest: latest.value, change, changePercent: prior && prior.value !== 0 && change !== null ? change / Math.abs(prior.value) * 100 : null, asOf: latest.date, observations: rows.length };
}
export function buildCommodityMacroContext(series: MacroSeries[]) {
  const byKey = Object.fromEntries(series.map(s => [s.key, summarizeMacroSeries(s)]));
  const inventory = byKey.crude_inventory as ReturnType<typeof summarizeMacroSeries> | undefined;
  const tenYear = byKey.us_10y as ReturnType<typeof summarizeMacroSeries> | undefined;
  const dollar = byKey.usd_broad as ReturnType<typeof summarizeMacroSeries> | undefined;
  const wti = byKey.wti_spot as ReturnType<typeof summarizeMacroSeries> | undefined;
  return { source: "Federal Reserve Bank of St. Louis (FRED)", fetchedAt: new Date().toISOString(), series: byKey,
    interpretation: {
      crudeInventory: inventory?.change === null || inventory?.change === undefined ? "אין מספיק נתונים" : inventory.change > 0 ? "מלאי הנפט בארה\"ב עלה בתקופת ההשוואה" : inventory.change < 0 ? "מלאי הנפט בארה\"ב ירד בתקופת ההשוואה" : "המלאי ללא שינוי",
      rates: tenYear?.change === null || tenYear?.change === undefined ? "אין מספיק נתונים" : tenYear.change > 0 ? "תשואת אג\"ח ארה\"ב ל-10 שנים עלתה" : tenYear.change < 0 ? "תשואת אג\"ח ארה\"ב ל-10 שנים ירדה" : "תשואת אג\"ח ללא שינוי",
      dollar: dollar?.change === null || dollar?.change === undefined ? "אין מספיק נתונים" : dollar.change > 0 ? "מדד הדולר הרחב התחזק" : dollar.change < 0 ? "מדד הדולר הרחב נחלש" : "מדד הדולר ללא שינוי",
      wti: wti?.latest === null || wti?.latest === undefined ? "מחיר ספוט WTI אינו זמין" : "מחיר ספוט WTI הוא נתון השוואה, לא מחיר חוזה עתידי"
    }, note: "ההשוואה היא בין התצפית האחרונה לתצפית לפני כ-20 פרסומים; תדירות הסדרות שונה. אין להסיק מכך תחזית מחיר." };
}
