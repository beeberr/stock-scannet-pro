import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const out = '.tmp-market-test';
const compile = spawnSync('npx', ['tsc','src/marketAnalysis.ts','--target','ES2022','--module','ES2022','--outDir',out,'--strict','--skipLibCheck'], { encoding:'utf8' });
if (compile.status !== 0) {
  process.stderr.write(compile.stdout + compile.stderr);
  process.exit(compile.status ?? 1);
}
try {
  const { simpleMovingAverage, relativeStrengthIndex, averageTrueRange, movingAverageConvergenceDivergence, analyzeTechnical } =
    await import(new URL('../' + out + '/marketAnalysis.js', import.meta.url));
  assert.equal(simpleMovingAverage([1,2,3,4],3),3);
  assert.equal(simpleMovingAverage([1,2],3),null);
  assert.equal(relativeStrengthIndex(Array.from({length:15},(_,i)=>100+i)),100);
  assert.equal(relativeStrengthIndex(Array.from({length:15},()=>100)),50);
  assert.equal(relativeStrengthIndex(Array.from({length:15},(_,i)=>100-i)),0);

  const candles = Array.from({length:60},(_,i)=>({
    time:new Date(Date.UTC(2026,0,i+1)).toISOString(),
    open:100+i, high:102+i, low:99+i, close:101+i, volume:1000+i
  }));
  assert.equal(averageTrueRange(candles,14),3);
  const macd = movingAverageConvergenceDivergence(candles.map(c=>c.close));
  assert.ok(macd && Number.isFinite(macd.line) && Number.isFinite(macd.signal) && macd.histogram > 0);
  const report = analyzeTechnical(candles);
  assert.equal(report.status,'READY');
  assert.equal(report.sma20,150.5);
  assert.equal(report.sma50,135.5);
  assert.equal(report.asOf,candles[59].time);
  assert.ok(report.observations.length >= 3);

  assert.equal(analyzeTechnical(candles.slice(0,19)).status,'INSUFFICIENT_DATA');
  assert.throws(()=>analyzeTechnical([candles[1],candles[0]]),/כרונולוגית/);
  assert.throws(()=>analyzeTechnical([{...candles[0],high:1}]),/OHLCV/);
  assert.throws(()=>simpleMovingAverage([1,2],0),/חיובי/);
  assert.throws(()=>movingAverageConvergenceDivergence([1,2,3],12,26,9),null);
  console.log('PASS: SMA, RSI, ATR, MACD, insufficient history, OHLCV validation and chronological validation');
} finally {
  rmSync(out,{recursive:true,force:true});
}
