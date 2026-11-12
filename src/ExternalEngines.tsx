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
type PublishedFeedStatus = {
  status: "READY" | "WAITING" | "UNAVAILABLE";
  updatedAt?: string | null;
  error?: string | null;
};
type ExternalStatusPayload = {
  alphasift: PublishedFeedStatus;
  dsa: PublishedFeedStatus;
};
const EXTERNAL_STATUS_URL = "/api/external/status";
const ALPHA_SUMMARY_URL = "/api/external/alphasift/latest";
const DSA_LATEST_URL = "/api/external/dsa/latest";
const ALPHA_ACTIONS_URL = "https://github.com/beeberr/alphasift/actions/workflows/track-record.yml";
const DSA_ACTIONS_URL = "https://github.com/beeberr/daily_stock_analysis/actions/workflows/00-daily-analysis.yml";
async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error || "שגיאת HTTP " + response.status);
  return payload as T;
}
function formatDate(value?: string) {
  if (!value) return "לא פורסם עדיין";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("he-IL");
}
function pretty(value: unknown) { return JSON.stringify(value, null, 2); }

export default function ExternalEngines() {
  const [alpha, setAlpha] = useState<AlphaSummary | null>(null);
  const [dsa, setDsa] = useState<DsaManifest | null>(null);
  const [alphaError, setAlphaError] = useState("");
  const [dsaError, setDsaError] = useState("");
  const [alphaWaiting, setAlphaWaiting] = useState(false);
  const [dsaWaiting, setDsaWaiting] = useState(false);
  const [alphaWaitingReason, setAlphaWaitingReason] = useState("");
  const [dsaWaitingReason, setDsaWaitingReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setAlphaError(""); setDsaError("");
    setAlphaWaiting(false); setDsaWaiting(false);
    setAlpha(null); setDsa(null);
    try {
      const status = await readJson<ExternalStatusPayload>(EXTERNAL_STATUS_URL);
      if (!status.alphasift || !status.dsa) throw new Error("סטטוס המנועים החיצוניים אינו מלא.");

      const [a, d] = await Promise.allSettled([
        status.alphasift.status === "READY" ? readJson<AlphaSummary>(ALPHA_SUMMARY_URL) : Promise.resolve(null),
        status.dsa.status === "READY" ? readJson<DsaManifest>(DSA_LATEST_URL) : Promise.resolve(null)
      ]);

      if (status.alphasift.status === "READY") {
        if (a.status === "fulfilled" && a.value) setAlpha(a.value);
        else setAlphaError(a.status === "rejected" && a.reason instanceof Error ? a.reason.message : "לא ניתן לטעון תוצאות AlphaSift.");
      } else if (status.alphasift.status === "WAITING") {
        setAlphaWaiting(true);
        setAlphaWaitingReason(status.alphasift.error || "ממתין לפרסום התוצאות הראשונות.");
      } else {
        setAlphaError(status.alphasift.error || "מקור התוצאות של AlphaSift אינו זמין.");
      }

      if (status.dsa.status === "READY") {
        if (d.status === "fulfilled" && d.value) setDsa(d.value);
        else setDsaError(d.status === "rejected" && d.reason instanceof Error ? d.reason.message : "לא ניתן לטעון דוחות Daily Stock Analysis.");
      } else if (status.dsa.status === "WAITING") {
        setDsaWaiting(true);
        setDsaWaitingReason(status.dsa.error || "ממתין לריצה הראשונה.");
      } else {
        setDsaError(status.dsa.error || "מקור התוצאות של Daily Stock Analysis אינו זמין.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "לא ניתן לבדוק את מצב המנועים החיצוניים.";
      setAlphaError(message);
      setDsaError(message);
    } finally {
      setUpdatedAt(new Date().toISOString());
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return <div className="external-engines">
    <section id="alphasift" className="engine-feature alpha-feature">
      <div className="sect"><div><h2>AlphaSift · מנוע סריקה ודירוג</h2><p>סריקות אסטרטגיות, דירוג מניות ותוצאות שמפורסמות מ-GitHub Actions</p></div><button type="button" className="primary" disabled={busy} onClick={() => void refresh()}>{busy ? "מרענן…" : "רענן תוצאות"}</button></div>
      <div className="alert">המנוע מציג את התוצאות האחרונות שפורסמו. ברירת המחדל של הפרויקט מתמקדת בעיקר בשווקים באסיה; יש לבדוק את השוק והאסטרטגיה בכל תוצאה.</div>
      <article className="engine-detail">
        <div className="engine-head"><b>מצב AlphaSift</b><span className={"engine-status " + (alpha ? "ready" : alphaError ? "unavailable" : "loading")}>{alpha ? "תוצאות זמינות" : alphaError ? "מקור לא זמין" : alphaWaiting ? "ממתין לפרסום" : "טוען…"}</span></div>
        {alphaError ? <p className="engine-error">{alphaError}</p> : alpha ? <>
          <div className="engine-metrics">
            <div><small>עודכן לאחרונה</small><strong>{formatDate(alpha.generated_at)}</strong></div>
            <div><small>ריצות שנשמרו</small><strong>{alpha.run_count ?? "—"}</strong></div>
            <div><small>שווקים</small><strong>{Array.isArray(alpha.markets) ? alpha.markets.map(m => typeof m === "string" ? m : m.name || m.id || "שוק").join(", ") : "—"}</strong></div>
          </div>
          <details className="engine-data"><summary>פתח נתוני סריקה מלאים</summary><pre>{pretty(alpha)}</pre></details>
        </> : alphaWaiting ? <p>{alphaWaitingReason || "ממתין לפרסום התוצאות הראשונות מענף track-record של AlphaSift."}</p> : <p>בודק זמינות תוצאות AlphaSift…</p>}
        <a className="engine-action" href={ALPHA_ACTIONS_URL} target="_blank" rel="noreferrer">פתח את AlphaSift ב-GitHub Actions להרצה ידנית</a>
      </article>
    </section>
    <section id="dsa" className="engine-feature dsa-feature">
      <div className="sect"><div><h2>Daily Stock Analysis · מנוע ניתוח עומק</h2><p>ניתוח מפורט ודוחות מניות שמופקים בריצות GitHub Actions</p></div><button type="button" className="primary" disabled={busy} onClick={() => void refresh()}>{busy ? "מרענן…" : "רענן תוצאות"}</button></div>
      <article className="engine-detail">
        <div className="engine-head"><b>מצב Daily Stock Analysis</b><span className={"engine-status " + (dsa ? "ready" : dsaError ? "unavailable" : "loading")}>{dsa ? "תוצאות פורסמו" : dsaError ? "מקור לא זמין" : dsaWaiting ? "ממתין לריצה ראשונה" : "טוען…"}</span></div>
        {dsaError ? <p className="engine-error">{dsaError}</p> : dsa ? <>
          <div className="engine-metrics">
            <div><small>עודכן לאחרונה</small><strong>{formatDate(dsa.updated_at)}</strong></div>
            <div><small>מצב הריצה</small><strong>{dsa.status || "לא ידוע"}</strong></div>
            <div><small>דוחות שנוצרו</small><strong>{dsa.report_count ?? "—"}</strong></div>
            <div><small>מספר ריצה</small><strong>{dsa.run_number || "—"}</strong></div>
          </div>
          {dsa.run_url ? <a className="engine-action" href={dsa.run_url} target="_blank" rel="noreferrer">פתח את ריצת GitHub Actions והורד את הדוחות ({dsa.artifact_name || "analysis artifact"})</a> : <p>עדיין לא פורסמה ריצה. הפעל ריצה ראשונה ב-GitHub Actions.</p>}
          <details className="engine-data"><summary>פתח פרטי פרסום מלאים</summary><pre>{pretty(dsa)}</pre></details>
        </> : dsaWaiting ? <p>{dsaWaitingReason || "ממתין לפרסום הדוח הראשון מענף engine-results של DSA."}</p> : <p>בודק זמינות Daily Stock Analysis…</p>}
        <a className="engine-action secondary" href={DSA_ACTIONS_URL} target="_blank" rel="noreferrer">פתח את Daily Stock Analysis ב-GitHub Actions להרצה ידנית</a>
      </article>
      <p className="hint" role="status">בדיקת האתר האחרונה: {formatDate(updatedAt)}</p>
      <p className="hint">התוצאות הן חומר מחקר בלבד, לא המלצה אישית ולא הוראת מסחר. זמני העדכון תלויים בלוחות הזמנים ובתורים של GitHub Actions.</p>
    </section>
  </div>;
}
