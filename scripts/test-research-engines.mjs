import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
const out='.tmp-engine-test';
const compile=spawnSync('npx',['tsc','src/researchEngines.ts','src/engineStatus.ts','--target','ES2022','--module','ES2022','--outDir',out,'--strict','--skipLibCheck'],{encoding:'utf8'});
if(compile.status!==0){process.stderr.write(compile.stdout+compile.stderr);process.exit(compile.status??1);}
try{
 const {analyzeMomentum}=await import(new URL('../'+out+'/researchEngines.js',import.meta.url));
 const {summarizeStatus,statusForTechnicalData,statusForMacroSeries,statusForValueData,statusForCommodityData,statusForIndicesPayload,statusForQuotesPayload,statusForNewsPayload,statusForDisclosureData,technicalMomentumRowStatus}=await import(new URL('../'+out+'/engineStatus.js',import.meta.url));
 const candles=Array.from({length:25},(_,i)=>({time:new Date(Date.UTC(2026,0,i+1)).toISOString(),open:100+i,high:102+i,low:99+i,close:101+i,volume:1000}));
 candles[candles.length-1]={...candles[candles.length-1],open:129,high:131,low:128,close:130};
 const result=analyzeMomentum(candles);
 assert.equal(result.status,'READY'); assert.equal(result.breakout20,true);
 assert.equal(result.averageVolume20,1000); assert.equal(result.relativeVolume,1);
 assert.equal(analyzeMomentum(candles.slice(0,20)).status,'INSUFFICIENT_DATA');
 assert.throws(()=>analyzeMomentum([{...candles[0],high:1}]),/OHLCV/);
 assert.equal(summarizeStatus(4,4,4),'READY');
 assert.equal(summarizeStatus(1,4,2),'PARTIAL');
 assert.equal(summarizeStatus(0,4,0),'UNAVAILABLE');
 assert.equal(technicalMomentumRowStatus('READY','READY'),'READY');
 assert.equal(technicalMomentumRowStatus('READY','INSUFFICIENT_DATA'),'PARTIAL');
 assert.equal(technicalMomentumRowStatus(undefined,undefined),'UNAVAILABLE');
 const mixed={AAPL:{technical:{status:'READY'},momentum:{status:'READY'}},MSFT:{technical:{status:'READY'},momentum:{status:'INSUFFICIENT_DATA'}}};
 assert.equal(statusForTechnicalData(mixed,'technical'),'READY');
 assert.equal(statusForTechnicalData(mixed,'momentum'),'PARTIAL');
 assert.equal(statusForMacroSeries({a:{status:'READY',latest:10},b:{status:'UNAVAILABLE',latest:null}}),'PARTIAL');
 assert.equal(statusForValueData({AAPL:{status:'READY',partial:false,valuation:{pe:20}},MSFT:{status:'UNAVAILABLE'}}),'PARTIAL');
 assert.equal(statusForValueData({AAPL:{status:'READY',partial:true,valuation:{pe:20}}}),'PARTIAL');
 const full={GC:{available:true,research:{technical:{status:'READY'},momentum:{status:'READY'}}},CL:{available:true,research:{technical:{status:'READY'},momentum:{status:'READY'}}}};
 assert.equal(statusForCommodityData(full),'READY');
 assert.equal(statusForCommodityData(full,true),'PARTIAL');
 assert.equal(statusForCommodityData({GC:{available:false}}),'UNAVAILABLE');
 assert.equal(statusForIndicesPayload({total:2,data:{SPY:{status:'READY'},QQQ:{status:'UNAVAILABLE'}}}),'PARTIAL');
 assert.equal(statusForQuotesPayload({available:0,total:4}),'UNAVAILABLE');
 assert.equal(statusForNewsPayload({status:'READY',errors:{news:null,earnings:'timeout'}}),'PARTIAL');
 assert.equal(statusForDisclosureData({AAPL:{status:'NO_RECENT_MATCHES'},MSFT:{status:'READY'}}),'READY');
 assert.equal(statusForDisclosureData({AAPL:{status:'READY'},MSFT:{status:'UNAVAILABLE'}}),'PARTIAL');
 console.log('PASS: eight-engine READY/PARTIAL/UNAVAILABLE classification, including stale and partial data');
}finally{rmSync(out,{recursive:true,force:true});}
