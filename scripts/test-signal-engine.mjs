import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const out = '.tmp-signal-test';
const compile = spawnSync('npx', ['tsc','src/marketAnalysis.ts','src/signalEngine.ts','--target','ES2022','--module','ES2022','--outDir',out,'--strict','--skipLibCheck'], { encoding:'utf8' });
if (compile.status !== 0) {
  process.stderr.write(compile.stdout + compile.stderr);
  process.exit(compile.status ?? 1);
}
try {
  const { assessLongSetup, evaluateLongExit } = await import(new URL('../' + out + '/signalEngine.js', import.meta.url));
  const candles = Array.from({length:90},(_,i)=>{
    const close = 100 + i * 0.28 + Math.sin(i * 0.8) * 1.8;
    const previous = 100 + Math.max(0,i-1) * 0.28 + Math.sin(Math.max(0,i-1) * 0.8) * 1.8;
    return {
      time:new Date(Date.UTC(2026,0,1+i)).toISOString(),
      open:previous, high:Math.max(previous,close)+1, low:Math.min(previous,close)-1,
      close, volume:i===89?1800:1000+(i%5)*20
    };
  });
  const result = assessLongSetup('aapl',candles,{equity:10000,riskPercent:0.5,rewardRisk:2});
  assert.equal(result.symbol,'AAPL');
  assert.equal(result.status,'READY');
  assert.ok(result.score >= 70, 'rising trend with positive momentum and volume should qualify');
  assert.equal(result.signal,'BUY_CANDIDATE');
  assert.ok(result.stopLoss < result.price);
  assert.ok(result.takeProfit > result.price);
  assert.ok(result.suggestedQuantity > 0);
  assert.ok(result.riskBudget <= 50);
  assert.ok(result.reasons.length >= 4);

  const shortHistory = assessLongSetup('CL',candles.slice(0,30),{equity:10000});
  assert.equal(shortHistory.status,'INSUFFICIENT_DATA');
  assert.equal(shortHistory.signal,'WAIT');
  assert.throws(()=>assessLongSetup('X',candles,{equity:0}),/ההון/);
  assert.throws(()=>assessLongSetup('X',candles,{equity:10000,riskPercent:3}),/אחוז הסיכון/);
  assert.throws(()=>assessLongSetup('X',candles,{equity:10000,rewardRisk:0.5}),/יחס סיכוי/);

  assert.equal(evaluateLongExit(90,90,120,false).action,'STOP_LOSS');
  assert.equal(evaluateLongExit(120,90,120,false).action,'TAKE_PROFIT');
  assert.equal(evaluateLongExit(105,90,120,true).action,'TREND_INVALIDATED');
  assert.equal(evaluateLongExit(105,90,120,false).action,'HOLD');
  assert.throws(()=>evaluateLongExit(10,20,15,false),/רמות יציאה/);
  console.log('PASS: signal scoring, ATR risk levels, position sizing, insufficient history, input validation and exit rules');
} finally {
  rmSync(out,{recursive:true,force:true});
}
