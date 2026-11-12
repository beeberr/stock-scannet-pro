import { useCallback, useEffect, useState } from "react";

type AlphaSummary = {
  generated_at?: string;
  run_count?: number;
  markets?: Array<string | { id?: string; name?: string; benchmark?: string }>;
  scorecard?: Array<Record<string, unknown>>;
  latest?: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
};

type DsaManifest = {
  schema_version?: number;
  engine?: string;
  updated_at?: string;
  run_id?: string;
  run_number?: string;
  status?: string;
  report_count?: number;
  artifact_name?: string;
  run_url?: string;
};

const ALPHA_SUMMARY_URL = "/api/external/alphasift/latest";
const DSA_LATEST_URL = "/api/external/dsa/latest";
const ALPHA_ACTIONS_URL = "https://github.com/beeberr/alphasift/actions/workflows/track-record.yml";
const DSA_ACTIONS_URL = "https://github.com/beeberr/daily_stock_analysis/actions/workflows/00-daily-analysis.yml";

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error || `שגיאת HTTP ${response.status}`);
  return payload as T;
}

function formatDate(value?: string) {
  if (!value) return "לא פורסם עדיין";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("he-IL");
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function ExternalEngines() {
  const [alpha, setAlpha] = useState<AlphaSummary | null>(null);
  const [dsa, setDsa] = useState<DsaManifest | null>(null);
  const [alphaError, setAlphaError] = useState("");
  const [dsaError, setDsaError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setAlphaError("");
    setDsaError("");
    const [a, d] = await Promise.allSettled([
      readJson<AlphaSummary>(ALPHA_SUMMARY_URL),
      readJson<DsaManifest>(DSA_LATEST_URL)
    ]);
    if (a.status === "fulfilled") setAlpha(a.value);
    else setAlphaError(a.reason instanceof Error ? a.reason.message : "לא ניתן לטעון נתוני AlphaSift.");
    if (d.status === "fulfilled") setDsa(d.value);
    else setDsaError(d.reason instanceof Error ? d.reason.message : "לא ניתן לטעון דוחות DSA.");
    setUpdatedAt(new Date().toISOString());
    setBusy(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return <section>
    <div className="sect">
      <div>
        <h2>מנועי ניתוח · GitHub Actions</h2>
        <p>AlphaSift לסריקה ודירוג · Daily Stock Analysis לניתוח עומק</p>
      </div>
      <button type="button" className="primary" disabled={busy} onClick={() => void refresh()}>{busy ? "מרענן…" : "רענן תוצאות"}</button>
    </div>

    <div className="alert">
      מנועי הניתוח רצים ב-GitHub Actions ואינם תלויים בשרת Render. האתר מציג את התוצאות האחרונות שפורסמו; אין כאן תהליך שרץ ברציפות או מסחר אוטומטי.
    </div>

    <div className="engines">
      <article>
        <div className="engine-head"><b>AlphaSift</b><span className="tag">{alpha ? "תוצאות זמינות" : alphaError ? "לא זמין" : "טוען…"}</span></div>
        <p>סריקות אסטרטגיות ותוצאות היסטוריות. ברירת המחדל של הפרויקט מתמקדת בעיקר בשווקים באסיה; יש לבדוק את השוק והאסטרטגיה בכל תוצאה.</p>
        {alphaError ? <small>{alphaError}</small> : alpha && <>
          <p><b>עודכן:</b> {formatDate(alpha.generated_at)}</p>
          <p><b>מספר ריצות שנשמרו:</b> {alpha.run_count ?? "—"}</p>
          <p><b>שווקים:</b> {Array.isArray(alpha.markets) ? alpha.markets.map(market => typeof market === "string" ? market : market.name || market.id || "שוק").join(", ") : "—"}</p>
          <details><summary>הצג נתוני סריקה מלאים</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:360,overflow:"auto"}}>{pretty(alpha)}</pre></details>
        </>}
        <a className="link" href={ALPHA_ACTIONS_URL} target="_blank" rel="noreferrer">פתיחת AlphaSift ב-GitHub Actions להרצה ידנית</a>
      </article>

      <article>
        <div className="engine-head"><b>Daily Stock Analysis</b><span className="tag">{dsa ? "תוצאות פורסמו" : dsaError ? "ממתין לריצה ראשונה" : "טוען…"}</span></div>
        <p>דוחות ניתוח שמופקים בריצות GitHub Actions. לאחר כל ריצה מוצלחת או כושלת מתעדכן קובץ מצב, והדוחות נשמרים בענף תוצאות נפרד.</p>
        {dsaError ? <small>{dsaError}</small> : dsa && <>
          <p><b>עודכן:</b> {formatDate(dsa.updated_at)}</p>
          <p><b>מצב הריצה האחרונה:</b> {dsa.status || "לא ידוע"}</p>
          <p><b>מספר ריצה:</b> {dsa.run_number || "—"}</p>
          <p><b>מספר דוחות שנוצרו:</b> {dsa.report_count ?? "—"}</p>
          {dsa.run_url ? <p><a className="link" href={dsa.run_url} target="_blank" rel="noreferrer">פתיחת ריצת GitHub Actions והורדת הדוח ({dsa.artifact_name || "analysis artifact"})</a></p> : <small>עדיין לא פורסמה ריצה. הפעל ריצה ראשונה ב-GitHub Actions.</small>}
          <details><summary>הצג נתוני פרסום</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:300,overflow:"auto"}}>{pretty(dsa)}</pre></details>
        </>}
        <a className="link" href={DSA_ACTIONS_URL} target="_blank" rel="noreferrer">פתיחת DSA ב-GitHub Actions להרצה ידנית</a>
      </article>
    </div>

    <p className="hint" role="status">בדיקת האתר האחרונה: {formatDate(updatedAt)}</p>
    <p className="hint">התוצאות הן חומר מחקר בלבד, לא המלצה אישית ולא הוראת מסחר. זמני העדכון תלויים בלוחות הזמנים ובתורים של GitHub Actions.</p>
  </section>;
}
