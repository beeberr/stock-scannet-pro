import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const out = '.tmp-opportunity-test';
const compile = spawnSync('npx', ['tsc','src/marketAnalysis.ts','src/opportunityEngine.ts','--target','ES2022','--module','ES2022','--outDir',out,'--strict','--skipLibCheck'], { encoding:'utf8' });
if (compile.status !== 0) {
  process.stderr.write(compile.stdout + compile.stderr);
  process.exit(compile.status ?? 1);
}
try {
  const { assessIntradayOpportunity } = await import(new URL('../' + out + '/opportunityEngine.js', import.meta.url));
  const now = Date.parse('2026-11-12T15:00:30.000Z');
  const candles = Array.from({length:30},(_,i)=>{
    const base = 10 + i * 0.015;
    const open = base - 0.01;
    const close = base + 0.01;
    return {
      time:new Date(now - (29-i)*60_000 - 30_000).toISOString(),
      open, high:close + 0.015, low:open - 0.015, close,
      volume:i===29?250_000:40_000
    };
  });
  candles[29].high = candles[29].close + 0.04;
  candles[29].close = candles[29].high - 0.001;
  const input = {
    symbol:'xyz', name:'Example Small Cap', exchange:'NASDAQ', source:'FixtureFeed',
    interval:'1min', fetchedAt:new Date(now).toISOString(), candles,
    averageDailyVolume20:1_000_000, sessionVolume:2_000_000, sessionProgress:0.5,
    averageDailyDollarVolume20:12_000_000
  };
  const result = assessIntradayOpportunity(input,{now});
  assert.equal(result.symbol,'XYZ');
  assert.equal(result.status,'READY');
  assert.equal(result.signal,'BREAKOUT');
  assert.ok(result.score >= 70);
  assert.ok(result.relativeVolumeEstimate >= 3.9);
  assert.ok(result.breakoutLevel < result.price);
  assert.ok(result.vwap > 0);
  assert.equal(result.source,'FixtureFeed');
  assert.ok(result.ageSeconds <= 60);

  const staleCandles = candles.map((c,i)=>({...c,time:new Date(now-20*60_000-(29-i)*60_000).toISOString()}));
  const stale = assessIntradayOpportunity({...input,candles:staleCandles,fetchedAt:new Date(now-20*60_000).toISOString()},{now});
  assert.equal(stale.signal,'STALE');
  assert.equal(stale.score,null);

  const missingVolume = assessIntradayOpportunity({...input,sessionVolume:undefined,sessionProgress:undefined},{now});
  assert.equal(missingVolume.status,'PARTIAL');
  assert.notEqual(missingVolume.signal,'BREAKOUT');
  assert.ok(missingVolume.limitations.some(x=>x.includes('RVOL')));

  const illiquid = assessIntradayOpportunity({...input,averageDailyDollarVolume20:100_000},{now});
  assert.equal(illiquid.signal,'ILLIQUID');

  const insufficient = assessIntradayOpportunity({...input,candles:candles.slice(0,10)},{now});
  assert.equal(insufficient.signal,'INSUFFICIENT_DATA');
  assert.equal(insufficient.status,'UNAVAILABLE');

  assert.throws(()=>assessIntradayOpportunity({...input,candles:[...candles,candles[29]]},{now}),/כרונולוגיים/);
  assert.throws(()=>assessIntradayOpportunity({...input,sessionProgress:1.5},{now}),/התקדמות המסחר/);
  assert.throws(()=>assessIntradayOpportunity({...input,source:''},{now}),/מקור הנתונים/);
  console.log('PASS opportunity discovery: intraday breakout, estimated relative volume, VWAP, liquidity, stale-data rejection, incomplete data and input validation');
} finally {
  rmSync(out,{recursive:true,force:true});
}
