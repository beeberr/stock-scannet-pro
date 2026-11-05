export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalAnalysis {
  status: 'READY' | 'INSUFFICIENT_DATA';
  asOf: string | null;
  observations: string[];
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  atr14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
}

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

function validateCandles(candles: readonly Candle[]): void {
  if (!Array.isArray(candles)) throw new Error('נתוני הנרות חייבים להיות מערך');
  if (candles.length > 10000) throw new Error('מספר הנרות חורג ממגבלת הניתוח');
  let previousTime = '';
  for (const candle of candles) {
    if (!candle || typeof candle.time !== 'string' || !candle.time || !Number.isFinite(Date.parse(candle.time))) {
      throw new Error('נמצא תאריך נר לא תקין');
    }
    if (previousTime && Date.parse(candle.time) <= Date.parse(previousTime)) {
      throw new Error('הנרות חייבים להיות מסודרים כרונולוגית וללא כפילויות');
    }
    previousTime = candle.time;
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
    if (!values.every(Number.isFinite) || values.some(value => value < 0) ||
        candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 ||
        candle.volume < 0 || candle.high < candle.low ||
        candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close)) {
      throw new Error('נמצא נר עם ערכי OHLCV לא תקינים');
    }
  }
}

export function simpleMovingAverage(values: readonly number[], period: number): number | null {
  if (!Number.isInteger(period) || period <= 0) throw new Error('תקופת ממוצע חייבת להיות מספר שלם חיובי');
  if (values.length < period) return null;
  const window = values.slice(-period);
  if (!window.every(Number.isFinite)) throw new Error('סדרת המחירים מכילה ערך לא תקין');
  return round(window.reduce((sum, value) => sum + value, 0) / period, 6);
}

export function relativeStrengthIndex(closes: readonly number[], period = 14): number | null {
  if (!Number.isInteger(period) || period <= 0) throw new Error('תקופת RSI חייבת להיות מספר שלם חיובי');
  if (closes.length <= period) return null;
  if (!closes.every(Number.isFinite)) throw new Error('סדרת המחירים מכילה ערך לא תקין');
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let averageGain = gain / period;
  let averageLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  if (averageGain === 0) return 0;
  return round(100 - 100 / (1 + averageGain / averageLoss), 4);
}

export function averageTrueRange(candles: readonly Candle[], period = 14): number | null {
  if (!Number.isInteger(period) || period <= 0) throw new Error('תקופת ATR חייבת להיות מספר שלם חיובי');
  if (candles.length <= period) return null;
  const ranges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < ranges.length; i++) atr = (atr * (period - 1) + ranges[i]) / period;
  return round(atr, 6);
}

function emaSeries(values: readonly number[], period: number): number[] {
  if (values.length < period) return [];
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const result = [seed];
  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    result.push((values[i] - result[result.length - 1]) * multiplier + result[result.length - 1]);
  }
  return result;
}

export function movingAverageConvergenceDivergence(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): { line: number; signal: number; histogram: number } | null {
  if (![fast, slow, signalPeriod].every(Number.isInteger) || fast <= 0 || slow <= fast || signalPeriod <= 0) {
    throw new Error('תקופות MACD אינן תקינות');
  }
  if (closes.length < slow + signalPeriod - 1) return null;
  if (!closes.every(Number.isFinite)) throw new Error('סדרת המחירים מכילה ערך לא תקין');
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const offset = slow - fast;
  const macdSeries = slowEma.map((value, index) => fastEma[index + offset] - value);
  const signalSeries = emaSeries(macdSeries, signalPeriod);
  const line = macdSeries[macdSeries.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  return { line: round(line, 6), signal: round(signal, 6), histogram: round(line - signal, 6) };
}

/** Descriptive indicators only; this function never emits a buy/sell recommendation. */
export function analyzeTechnical(candles: readonly Candle[]): TechnicalAnalysis {
  validateCandles(candles);
  const closes = candles.map(candle => candle.close);
  const sma20 = simpleMovingAverage(closes, 20);
  const sma50 = simpleMovingAverage(closes, 50);
  const rsi14 = relativeStrengthIndex(closes, 14);
  const atr14 = averageTrueRange(candles, 14);
  const macd = movingAverageConvergenceDivergence(closes);
  const observations: string[] = [];
  if (sma20 !== null && sma50 !== null) {
    observations.push(sma20 > sma50 ? 'הממוצע ל-20 תקופות מעל הממוצע ל-50' :
      sma20 < sma50 ? 'הממוצע ל-20 תקופות מתחת לממוצע ל-50' : 'הממוצעים ל-20 ול-50 תקופות שווים');
  }
  if (rsi14 !== null) {
    observations.push(rsi14 >= 70 ? 'RSI באזור גבוה יחסית' : rsi14 <= 30 ? 'RSI באזור נמוך יחסית' : 'RSI בטווח האמצעי');
  }
  if (macd !== null) observations.push(macd.histogram > 0 ? 'היסטוגרמת MACD חיובית' : macd.histogram < 0 ? 'היסטוגרמת MACD שלילית' : 'היסטוגרמת MACD אפסית');
  return {
    status: candles.length >= 50 ? 'READY' : 'INSUFFICIENT_DATA',
    asOf: candles.at(-1)?.time ?? null,
    observations,
    sma20,
    sma50,
    rsi14,
    atr14,
    macd
  };
}
