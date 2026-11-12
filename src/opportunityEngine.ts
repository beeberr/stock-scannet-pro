import type { Candle } from './marketAnalysis.js';

export type OpportunitySignal = 'BREAKOUT' | 'EARLY_MOMENTUM' | 'WATCH' | 'NO_SIGNAL' | 'STALE' | 'INSUFFICIENT_DATA' | 'ILLIQUID';

export interface IntradayOpportunityInput {
  symbol: string;
  name?: string;
  exchange?: string;
  source: string;
  interval: '1min' | '5min';
  fetchedAt: string;
  candles: readonly Candle[];
  averageDailyVolume20?: number;
  sessionVolume?: number;
  sessionProgress?: number;
  averageDailyDollarVolume20?: number;
}

export interface OpportunityAssessment {
  symbol: string;
  name: string | null;
  exchange: string | null;
  status: 'READY' | 'PARTIAL' | 'UNAVAILABLE';
  signal: OpportunitySignal;
  score: number | null;
  price: number | null;
  asOf: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  source: string;
  interval: '1min' | '5min';
  breakoutLevel: number | null;
  vwap: number | null;
  relativeVolumeEstimate: number | null;
  averageDailyDollarVolume20: number | null;
  atrPercent: number | null;
  reasons: string[];
  limitations: string[];
  disclaimer: string;
}

export interface OpportunityOptions {
  now?: number;
  minimumPrice?: number;
  minimumAverageDailyDollarVolume?: number;
}

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

function validateInput(input: IntradayOpportunityInput): void {
  if (!input.symbol.trim()) throw new Error('סימול המניה חסר');
  if (!input.source.trim()) throw new Error('מקור הנתונים חסר');
  if (!Number.isFinite(Date.parse(input.fetchedAt))) throw new Error('חותמת זמן איסוף הנתונים אינה תקינה');
  if (!Array.isArray(input.candles)) throw new Error('נתוני הנרות חייבים להיות מערך');
  let previous = -Infinity;
  for (const candle of input.candles) {
    const timestamp = Date.parse(candle.time);
    if (!Number.isFinite(timestamp) || timestamp <= previous) {
      throw new Error('נרות המסחר חייבים להיות תקינים, כרונולוגיים וללא כפילויות');
    }
    previous = timestamp;
    if (![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) ||
        candle.open <= 0 || candle.low <= 0 || candle.close <= 0 ||
        candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close) || candle.volume < 0) {
      throw new Error('נמצא נר מסחר עם נתוני OHLCV לא תקינים');
    }
  }
  for (const [label, value] of [
    ['מחזור יומי ממוצע', input.averageDailyVolume20],
    ['מחזור מסחר נוכחי', input.sessionVolume],
    ['התקדמות המסחר', input.sessionProgress],
    ['מחזור כספי יומי ממוצע', input.averageDailyDollarVolume20]
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(label + ' אינו תקין');
    }
  }
  if (input.sessionProgress !== undefined && input.sessionProgress > 1) {
    throw new Error('התקדמות המסחר חייבת להיות בין 0 ל-1');
  }
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateVwap(candles: readonly Candle[]): number | null {
  const volume = candles.reduce((sum, candle) => sum + candle.volume, 0);
  if (volume <= 0) return null;
  return candles.reduce((sum, candle) =>
    sum + ((candle.high + candle.low + candle.close) / 3) * candle.volume, 0) / volume;
}

/**
 * Scores a fresh intraday setup. This is a discovery/ranking aid, not an order signal.
 * Relative volume is a linear time-of-session estimate, not a seasonality-adjusted RVOL.
 */
export function assessIntradayOpportunity(
  input: IntradayOpportunityInput,
  options: OpportunityOptions = {}
): OpportunityAssessment {
  validateInput(input);
  const symbol = input.symbol.trim().toUpperCase();
  const now = options.now ?? Date.now();
  const fetchedAtMs = Date.parse(input.fetchedAt);
  const latest = input.candles[input.candles.length - 1] ?? null;
  const asOfMs = latest ? Date.parse(latest.time) : null;
  const ageSeconds = asOfMs === null ? null : Math.max(0, Math.floor((now - asOfMs) / 1000));
  const intervalMs = input.interval === '1min' ? 60_000 : 300_000;
  const maxAgeMs = intervalMs * 3 + 60_000;
  const base = {
    symbol, name: input.name ?? null, exchange: input.exchange ?? null,
    fetchedAt: input.fetchedAt, ageSeconds, source: input.source, interval: input.interval,
    disclaimer: 'איתור מחקרי בלבד — לא הוראת קנייה או מכירה. נתוני הספק, עיכוב, מרווח, החלקה ונזילות עשויים לשנות את התוצאה.'
  } as const;

  if (!latest || input.candles.length < 21) {
    return {
      ...base, status: 'UNAVAILABLE', signal: 'INSUFFICIENT_DATA', score: null,
      price: latest?.close ?? null, asOf: latest?.time ?? null, breakoutLevel: null,
      vwap: null, relativeVolumeEstimate: null,
      averageDailyDollarVolume20: input.averageDailyDollarVolume20 ?? null,
      atrPercent: null, reasons: ['נדרשים לפחות 21 נרות תוך־יומיים תקינים'],
      limitations: ['אין מספיק היסטוריה תוך־יומית כדי לבדוק פריצה של 20 נרות']
    };
  }

  const reasons: string[] = [];
  const limitations: string[] = [];
  if (now - fetchedAtMs > maxAgeMs || now - (asOfMs ?? 0) > maxAgeMs) {
    return {
      ...base, status: 'UNAVAILABLE', signal: 'STALE', score: null,
      price: latest.close, asOf: latest.time, breakoutLevel: null, vwap: null,
      relativeVolumeEstimate: null, averageDailyDollarVolume20: input.averageDailyDollarVolume20 ?? null,
      atrPercent: null, reasons: ['הנתון האחרון ישן מדי למסחר תוך־יומי; לא נוצר איתות'],
      limitations: ['נדרש נר עדכני ביחס למסגרת הזמן שנבחרה']
    };
  }

  const prior = input.candles.slice(-21, -1);
  const breakoutLevel = Math.max(...prior.map(candle => candle.high));
  const vwap = calculateVwap(input.candles);
  const lastFive = input.candles.slice(-5);
  const priorFive = input.candles.slice(-10, -5);
  const shortTrend = average(lastFive.map(candle => candle.close)) > average(priorFive.map(candle => candle.close));
  const bullishClose = latest.close > latest.open &&
    (latest.high - latest.close) / Math.max(latest.high - latest.low, 0.000001) <= 0.25;
  const ranges = input.candles.slice(-14).map((candle, index, rows) => {
    const previousClose = index === 0 ? input.candles[input.candles.length - 15].close : rows[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  const atrPercent = average(ranges) / latest.close * 100;
  const breakout = latest.close > breakoutLevel;
  const nearBreakout = !breakout && latest.close >= breakoutLevel * 0.997;
  const relativeVolumeEstimate = input.averageDailyVolume20 !== undefined &&
    input.sessionVolume !== undefined && input.sessionProgress !== undefined &&
    input.averageDailyVolume20 > 0 && input.sessionProgress >= 0.05
      ? input.sessionVolume / (input.averageDailyVolume20 * input.sessionProgress)
      : null;

  let score = 0;
  if (breakout) { score += 25; reasons.push('מחיר הנר האחרון פרץ מעל שיא 20 הנרות הקודמים'); }
  else if (nearBreakout) { score += 10; reasons.push('המחיר מתקרב עד 0.3% לרמת פריצת 20 הנרות'); }
  else reasons.push('לא זוהתה פריצה של טווח 20 הנרות');

  if (relativeVolumeEstimate !== null) {
    if (relativeVolumeEstimate >= 3) { score += 25; reasons.push('מחזור יחסי משוער גבוה פי 3 ומעלה'); }
    else if (relativeVolumeEstimate >= 2) { score += 20; reasons.push('מחזור יחסי משוער גבוה פי 2 ומעלה'); }
    else if (relativeVolumeEstimate >= 1.5) { score += 14; reasons.push('מחזור יחסי משוער גבוה מהממוצע'); }
    else reasons.push('המחזור היחסי אינו חריג');
  } else {
    limitations.push('חסרים מחזור יומי ממוצע, מחזור סשן או התקדמות סשן; לא חושב RVOL');
  }

  if (vwap !== null && latest.close > vwap) { score += 15; reasons.push('המחיר מעל VWAP של חלון הנרות שנבדק'); }
  else reasons.push('המחיר אינו מעל VWAP של חלון הנרות');
  if (shortTrend) { score += 10; reasons.push('הממוצע של חמשת הנרות האחרונים עולה'); }
  if (bullishClose) { score += 10; reasons.push('הנר האחרון נסגר בחלק העליון של הטווח'); }
  if (latest.close > input.candles[0].open && latest.close / input.candles[0].open >= 1.01) {
    score += 10;
    reasons.push('המחיר עלה לפחות 1% בחלון הניתוח');
  }
  if (atrPercent > 5) { score -= 10; reasons.push('תנודתיות תוך־יומית גבוהה מפחיתה את הציון'); }

  const minimumPrice = options.minimumPrice ?? 2;
  const minimumDollarVolume = options.minimumAverageDailyDollarVolume ?? 1_000_000;
  const liquidityKnown = input.averageDailyDollarVolume20 !== undefined;
  const liquid = liquidityKnown && input.averageDailyDollarVolume20! >= minimumDollarVolume && latest.close >= minimumPrice;
  if (!liquidityKnown) limitations.push('מחזור כספי יומי ממוצע חסר; נזילות לא אומתה');
  else if (!liquid) reasons.push('המניה אינה עוברת את סף המחיר או המחזור הכספי הממוצע');

  const complete = relativeVolumeEstimate !== null && liquidityKnown;
  const status: OpportunityAssessment['status'] = complete ? 'READY' : 'PARTIAL';
  let signal: OpportunitySignal = 'NO_SIGNAL';
  if (liquidityKnown && !liquid) signal = 'ILLIQUID';
  else if (complete && breakout && relativeVolumeEstimate! >= 1.8 && score >= 70) signal = 'BREAKOUT';
  else if (complete && nearBreakout && relativeVolumeEstimate! >= 1.5 && score >= 60) signal = 'EARLY_MOMENTUM';
  else if (score >= 40) signal = 'WATCH';

  return {
    ...base, status, signal, score: round(Math.max(0, Math.min(100, score))),
    price: latest.close, asOf: latest.time, breakoutLevel: round(breakoutLevel, 4),
    vwap: vwap === null ? null : round(vwap, 4),
    relativeVolumeEstimate: relativeVolumeEstimate === null ? null : round(relativeVolumeEstimate, 2),
    averageDailyDollarVolume20: input.averageDailyDollarVolume20 ?? null,
    atrPercent: round(atrPercent, 3), reasons, limitations
  };
}
