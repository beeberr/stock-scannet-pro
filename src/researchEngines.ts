import type { Candle } from './marketAnalysis.js';

export interface MomentumAnalysis {
  status: 'READY' | 'INSUFFICIENT_DATA';
  breakout20: boolean;
  averageVolume20: number | null;
  latestVolume: number | null;
  relativeVolume: number | null;
  atrPercent: number | null;
}

/** Calculates descriptive short-term momentum metrics from completed daily candles. */
export function analyzeMomentum(candles: readonly Candle[]): MomentumAnalysis {
  if (!Array.isArray(candles) || candles.some((c, i) =>
    !c || !Number.isFinite(Date.parse(c.time)) ||
    ![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) ||
    c.open <= 0 || c.low <= 0 || c.high < Math.max(c.open,c.close) ||
    c.low > Math.min(c.open,c.close) || c.volume < 0 ||
    (i > 0 && Date.parse(c.time) <= Date.parse(candles[i-1].time))
  )) throw new Error('נתוני מומנטום מכילים נרות OHLCV לא תקינים');
  if (candles.length < 21) return {
    status:'INSUFFICIENT_DATA', breakout20:false, averageVolume20:null,
    latestVolume:candles.at(-1)?.volume ?? null, relativeVolume:null, atrPercent:null
  };
  const latest = candles[candles.length-1];
  const previous = candles.slice(-21,-1);
  const averageVolume20 = previous.reduce((sum,c)=>sum+c.volume,0)/20;
  const resistance20 = Math.max(...previous.map(c=>c.high));
  const ranges = candles.slice(-14).map((c,i,a) => {
    const prev = i===0 ? candles[candles.length-15].close : a[i-1].close;
    return Math.max(c.high-c.low,Math.abs(c.high-prev),Math.abs(c.low-prev));
  });
  const atr = ranges.reduce((sum,v)=>sum+v,0)/ranges.length;
  return {
    status:'READY', breakout20:latest.close>resistance20, averageVolume20,
    latestVolume:latest.volume,
    relativeVolume:averageVolume20>0?Number((latest.volume/averageVolume20).toFixed(4)):null,
    atrPercent:Number((atr/latest.close*100).toFixed(4))
  };
}
