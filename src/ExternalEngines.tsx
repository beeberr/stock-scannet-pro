import { useState, type FormEvent } from "react";

type EngineStatus = {
  fetchedAt?: string;
  alphasift?: { configured?: boolean; status?: string; httpStatus?: number; error?: string };
  dsa?: { configured?: boolean; status?: string; httpStatus?: number; error?: string };
};

export default function ExternalEngines() {
  const [accessKey, setAccessKey] = useState("");
  const [symbol, setSymbol] = useState("AAPL");
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [overview, setOverview] = useState<any>(null);
  const [strategies, setStrategies] = useState<any>(null);
  const [runs, setRuns] = useState<any>(null);
  const [taskId, setTaskId] = useState("");
  const [dsaResult, setDsaResult] = useState<any>(null);
  const [message, setMessage] = useState("הזן מפתח גישה כדי לבדוק את החיבורים.");
  const [busy, setBusy] = useState(false);

  const headers = { "x-engine-access-key": accessKey, Accept: "application/json" };
  async function getJson(path: string) {
    const response = await fetch(path, { headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `שגיאת HTTP ${response.status}`);
    return payload;
  }

  async function checkConnections() {
    if (!accessKey.trim()) { setMessage("נדרש מפתח גישה."); return; }
    setBusy(true); setMessage("בודק חיבורים…");
    try {
      const next = await getJson("/api/external/status");
      setStatus(next);
      setMessage("בדיקת החיבורים הושלמה. מצב השירותים מוצג בנפרד.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "בדיקת החיבורים נכשלה.");
    } finally { setBusy(false); }
  }

  async function loadAlphaSift() {
    setBusy(true); setMessage("טוען נתוני AlphaSift…");
    try {
      const [o, s, r] = await Promise.all([
        getJson("/api/external/alphasift/overview"),
        getJson("/api/external/alphasift/strategies"),
        getJson("/api/external/alphasift/runs?limit=10")
      ]);
      setOverview(o); setStrategies(s); setRuns(r);
      setMessage("נתוני AlphaSift נטענו. זהו ממשק הקריאה בלבד של השירות.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "טעינת AlphaSift נכשלה.");
    } finally { setBusy(false); }
  }

  async function startDsaAnalysis(event: FormEvent) {
    event.preventDefault();
    if (!accessKey.trim()) { setMessage("נדרש מפתח גישה."); return; }
    setBusy(true); setDsaResult(null); setTaskId(""); setMessage("שולח בקשת ניתוח ל-DSA…");
    try {
      const response = await fetch("/api/external/dsa/analyze", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ stock_code: symbol.trim().toUpperCase() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.message || `שגיאת HTTP ${response.status}`);
      setDsaResult(payload);
      const id = payload.task_id || payload.taskId || payload.query_id || payload.queryId;
      if (id) setTaskId(String(id));
      setMessage(id ? "המשימה התקבלה ב-DSA. אפשר לבדוק את הסטטוס." : "DSA החזיר תשובה. בדוק את הדוח למטה.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "הניתוח לא נשלח.");
    } finally { setBusy(false); }
  }

  async function refreshDsaStatus() {
    if (!taskId) return;
    setBusy(true); setMessage("בודק סטטוס משימת DSA…");
    try {
      const payload = await getJson("/api/external/dsa/status/" + encodeURIComponent(taskId));
      setDsaResult(payload);
      setMessage("סטטוס המשימה עודכן.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "לא ניתן לעדכן סטטוס.");
    } finally { setBusy(false); }
  }

  const pretty = (value: any) => JSON.stringify(value, null, 2);
  const label = (value?: string) => value === "READY" ? "מחובר" : value === "UNCONFIGURED" ? "לא הוגדר" : value === "UNAVAILABLE" ? "לא זמין" : value || "טרם נבדק";

  return <section>
    <div className="sect"><div><h2>חיבור מנועי AI חיצוניים</h2><p>AlphaSift לסריקה ודירוג · Daily Stock Analysis לניתוח מניה לעומק</p></div></div>
    <div className="alert amber">החיבור מוגן במפתח גישה. הזן כאן את אותו מפתח שהוגדר ב-Cloudflare כ-EXTERNAL_ENGINE_ACCESS_KEY. המפתח נשאר בזיכרון המסך בלבד ואינו נשמר בדפדפן.</div>
    <div className="form">
      <label>מפתח גישה<input type="password" value={accessKey} onChange={e => setAccessKey(e.target.value)} autoComplete="off" placeholder="EXTERNAL_ENGINE_ACCESS_KEY" /></label>
      <button type="button" className="primary" disabled={busy || !accessKey.trim()} onClick={checkConnections}>{busy ? "בודק…" : "בדוק חיבורים"}</button>
    </div>
    <div className="engines">
      <article><div className="engine-head"><b>AlphaSift</b><span className="tag">{label(status?.alphasift?.status)}</span></div><p>ממשק אסטרטגיות, תמונת מצב, היסטוריית סריקות ודוחות. שרת serve הרשמי הוא לקריאה בלבד; הוא אינו מפעיל סריקה חדשה דרך HTTP.</p><small>{status?.alphasift?.error || (status?.alphasift?.httpStatus ? "HTTP " + status.alphasift.httpStatus : "נדרשת כתובת ALPHASIFT_BASE_URL")}</small><button type="button" className="link" disabled={busy || !accessKey.trim()} onClick={loadAlphaSift}>טען אסטרטגיות ונתוני סריקה</button></article>
      <article><div className="engine-head"><b>Daily Stock Analysis</b><span className="tag">{label(status?.dsa?.status)}</span></div><p>ניתוח עומק למניה לפי סימול, דרך API אסינכרוני עם מזהה משימה.</p><small>{status?.dsa?.error || (status?.dsa?.httpStatus ? "HTTP " + status.dsa.httpStatus : "נדרשת כתובת DSA_BASE_URL")}</small>
        <form onSubmit={startDsaAnalysis} className="form"><label>סימול מניה<input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} maxLength={16} required placeholder="AAPL" /></label><button className="primary" disabled={busy || !accessKey.trim()}>הפעל ניתוח DSA</button></form>
        {taskId && <button type="button" className="link" disabled={busy} onClick={refreshDsaStatus}>בדוק סטטוס משימה {taskId}</button>}
      </article>
    </div>
    <p className="hint" role="status">{message}</p>
    {overview && <article><h3>AlphaSift · תמונת מצב</h3><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:320,overflow:"auto"}}>{pretty(overview)}</pre></article>}
    {strategies && <article><h3>AlphaSift · אסטרטגיות</h3><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:320,overflow:"auto"}}>{pretty(strategies)}</pre></article>}
    {runs && <article><h3>AlphaSift · סריקות אחרונות</h3><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:320,overflow:"auto"}}>{pretty(runs)}</pre></article>}
    {dsaResult && <article><h3>Daily Stock Analysis · תוצאת ניתוח</h3><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:420,overflow:"auto"}}>{pretty(dsaResult)}</pre></article>}
    <p className="hint">התוצאות מוצגות כחומר מחקר בלבד. אין כאן הוראות מסחר או ביצוע עסקאות. AlphaSift מכוון בעיקר לשוק הסיני כברירת מחדל ותמיכת ארה״ב תלויה באסטרטגיה ובספק הנתונים שהוגדרו.</p>
  </section>;
}
