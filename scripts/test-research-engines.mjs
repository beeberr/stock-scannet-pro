import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
const out='.tmp-engine-test';
const compile=spawnSync('npx',['tsc','src/researchEngines.ts','--target','ES2022','--module','ES2022','--outDir',out,'--strict','--skipLibCheck'],{encoding:'utf8'});
if(compile.status!==0){process.stderr.write(compile.stdout+compile.stderr);process.exit(compile.status??1);}
try{
 const {analyzeMomentum}=await import(new URL('../'+out+'/researchEngines.js',import.meta.url));
 const candles=Array.from({length:25},(_,i)=>({time:new Date(Date.UTC(2026,0,i+1)).toISOString(),open:100+i,high:102+i,low:99+i,close:101+i,volume:1000}));
 const result=analyzeMomentum(candles);
 assert.equal(result.status,'READY'); assert.equal(result.breakout20,true);
 assert.equal(result.averageVolume20,1000); assert.equal(result.relativeVolume,1);
 assert.equal(analyzeMomentum(candles.slice(0,20)).status,'INSUFFICIENT_DATA');
 assert.throws(()=>analyzeMomentum([{...candles[0],high:1}]),/OHLCV/);
 console.log('PASS: momentum history, breakout, relative volume and invalid-candle checks');
}finally{rmSync(out,{recursive:true,force:true});}
