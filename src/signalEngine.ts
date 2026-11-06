import { analyzeTechnical, type Candle } from './marketAnalysis.js';

export type TradeSignal = 'BUY_CANDIDATE' | 'WAIT' | 'AVOID';
export type ExitSignal = 'HOLD' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'TREND_INVALIDATED';

export interface SignalAssessment {
  symbol: string;
  status: 'READY' | 'INSUFFICIENT_DATA';
  asOf: string | null;
  price: number | null;
  signal: TradeSignal;
  score: number | null;
  reasons: string[];
  entryReference: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskPerUnit: number | null;
  riskBudget: number | null;
  suggestedQuantity: number | null;
  riskReward: number | null;
  disclaimer: string;
}

export interface SignalOptions {
  equity: number;
  riskPercent?: number;
  rewardRisk?: number;
}

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/**
 * Scores a long-only setup from completed OHLCV candles.
 * It is a research candidate, not an order or a prediction of guaranteed returns.
 */
export function assessLongSetup(
  symbol: string,
  candles: readonly Candle[],
  options: SignalOptions
): SignalAssessment {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) throw new Error('יש להזין סימול נכס');
  if (!Number.isFinite(options.equity) || options.equity <= 0) throw new Error('ההון חייב להיות גדול מאפס');
  const riskPercent = options.riskPercent ?? 0.5;
  const rewardRisk = options.rewardRisk ?? 2;
  if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 2) {
    throw new Error('אחוז הסיכון לעסקה חייב להיות מעל 0 ועד 2');
  }
  if (!Number.isFinite(rewardRisk) || rewardRisk < 1 || rewardRisk > 5) {
    throw new Error('יחס סיכוי/סיכון חייב להיות בין 1 ל-5');
  }

  const technical = analyzeTechnical(candles);
  const latest = candles[candles.length - 1];
  if (technical.status !== 'READY' || !latest || technical.atr14 === null ||
      technical.sma20 === null || technical.sma50 === null || technical.rsi14 === null ||
      technical.macd === null) {
    return {
      symbol: normalizedSymbol, status: 'INSUFFICIENT_DATA', asOf: technical.asOf,
      price: latest?.close ?? null, signal: 'WAIT', score: null, reasons: ['אין מספיק היסטוריה לחישוב אמין'],
      entryReference: null, stopLoss: null, takeProfit: null, riskPerUnit: null,
      riskBudget: null, suggestedQuantity: null, riskReward: null,
      disclaimer: 'נדרשים לפחות 50 נרות תקינים. אין זו המלצת השקעה.'
    };
  }

  const recentVolume = candles.slice(-20).reduce((sum, candle) => sum + candle.volume, 0) / 20;
  const previous = candles[candles.length - 2];
  let score = 0;
  const reasons: string[] = [];

  if (latest.close > technical.sma20 && technical.sma20 > technical.sma50) {
    score += 30;
    reasons.push('מגמה חיובית: המחיר מעל SMA20 וממוצע 20 מעל SMA50');
  } else if (latest.close > technical.sma50) {
    score += 15;
    reasons.push('המחיר מעל SMA50, אך מבנה המגמה אינו מלא');
  } else {
    reasons.push('המגמה אינה תומכת כרגע בכניסה ללונג');
  }

  if (technical.rsi14 >= 50 && technical.rsi14 <= 68) {
    score += 20;
    reasons.push('RSI תומך במומנטום ללא קניית יתר קיצונית');
  } else if (technical.rsi14 > 68) {
    score += 5;
    reasons.push('RSI גבוה — קיים סיכון לרדיפה אחרי המחיר');
  } else {
    reasons.push('RSI אינו מאשר מומנטום חיובי');
  }

  if (technical.macd.histogram > 0 && technical.macd.line > technical.macd.signal) {
    score += 20;
    reasons.push('MACD חיובי ומאשר מומנטום');
  } else {
    reasons.push('MACD עדיין אינו מאשר מומנטום חיובי');
  }

  if (recentVolume > 0 && latest.volume >= recentVolume * 1.2) {
    score += 15;
    reasons.push('מחזור המסחר גבוה לפחות ב-20% מהממוצע של 20 הנרות');
  } else {
    reasons.push('אין אישור חריג במחזור המסחר');
  }

  if (previous && latest.close > previous.close) {
    score += 15;
    reasons.push('הנר האחרון נסגר בעלייה');
  } else {
    reasons.push('הנר האחרון אינו מאשר המשך עלייה');
  }

  const signal: TradeSignal = score >= 70 ? 'BUY_CANDIDATE' : score >= 45 ? 'WAIT' : 'AVOID';
  const entryReference = latest.close;
  const riskPerUnit = round(technical.atr14 * 1.5, 6);
  const stopLoss = round(entryReference - riskPerUnit, 6);
  const takeProfit = round(entryReference + riskPerUnit * rewardRisk, 6);
  const riskBudget = round(options.equity * riskPercent / 100, 2);
  const suggestedQuantity = riskPerUnit > 0 && stopLoss > 0
    ? Math.floor((riskBudget / riskPerUnit) * 1e6) / 1e6
    : 0;

  if (signal !== 'BUY_CANDIDATE') reasons.push('הציון אינו עומד בסף שנקבע למועמדת כניסה');
  if (suggestedQuantity <= 0) reasons.push('לא ניתן לחשב כמות בטוחה לפי מרחק הסטופ וההון');

  return {
    symbol: normalizedSymbol, status: 'READY', asOf: technical.asOf, price: latest.close,
    signal: suggestedQuantity > 0 ? signal : 'AVOID', score, reasons,
    entryReference, stopLoss, takeProfit, riskPerUnit, riskBudget,
    suggestedQuantity, riskReward: rewardRisk,
    disclaimer: 'מחיר הייחוס מבוסס על הנר האחרון שהושלם. הכמות היא חישוב סיכון תאורטי בלבד; יש להביא בחשבון מרווח, החלקה, נזילות, פערי פתיחה ועלויות. אין לבצע פקודה אוטומטית.'
  };
}

/** Evaluates an existing long position against pre-defined risk levels. */
export function evaluateLongExit(
  currentPrice: number,
  stopLoss: number,
  takeProfit: number,
  closeBelowTrend: boolean
): { action: ExitSignal; reason: string } {
  if (![currentPrice, stopLoss, takeProfit].every(Number.isFinite) ||
      currentPrice <= 0 || stopLoss <= 0 || takeProfit <= stopLoss) {
    throw new Error('מחיר או רמות יציאה אינם תקינים');
  }
  if (currentPrice <= stopLoss) return { action: 'STOP_LOSS', reason: 'המחיר הגיע לסטופ או ירד מתחתיו' };
  if (currentPrice >= takeProfit) return { action: 'TAKE_PROFIT', reason: 'המחיר הגיע ליעד הרווח או עבר אותו' };
  if (closeBelowTrend) return { action: 'TREND_INVALIDATED', reason: 'המגמה שהצדיקה את העסקה נחלשה' };
  return { action: 'HOLD', reason: 'לא הופעל תנאי יציאה שהוגדר מראש' };
}
