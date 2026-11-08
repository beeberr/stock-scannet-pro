import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const out = '.tmp-massive-test';
const compile = spawnSync('npx', ['tsc','src/massiveFutures.ts','--target','ES2022','--module','ES2022','--outDir',out,'--strict','--skipLibCheck'], { encoding:'utf8' });
if (compile.status !== 0) {
  process.stderr.write(compile.stdout + compile.stderr);
  process.exit(compile.status ?? 1);
}
try {
  const { FUTURES_PRODUCTS, selectFrontContract, normalizeFuturesQuote } =
    await import(new URL('../' + out + '/massiveFutures.js', import.meta.url));

  const contracts = [
    { product_code:'GC', ticker:'GCZ6', active:true, type:'single', days_to_maturity:42, last_trade_date:'2026-12-20' },
    { product_code:'GC', ticker:'GCG7', active:true, type:'single', days_to_maturity:132, last_trade_date:'2027-03-20' },
    { product_code:'GC', ticker:'GCX6', active:true, type:'single', days_to_maturity:3, last_trade_date:'2026-11-11' },
    { product_code:'GC', ticker:'GCZ6-GCG7', active:true, type:'combo', days_to_maturity:42, last_trade_date:'2026-12-20' },
    { product_code:'SI', ticker:'SIZ6', active:false, type:'single', days_to_maturity:42, last_trade_date:'2026-12-20' }
  ];
  assert.equal(selectFrontContract(contracts,'GC')?.ticker,'GCZ6');
  assert.equal(selectFrontContract(contracts,'SI'),null);
  assert.equal(selectFrontContract(contracts,'GC',200),null);
  assert.throws(()=>selectFrontContract(contracts,'GC',-1),/שלילי/);

  const quote = normalizeFuturesQuote(FUTURES_PRODUCTS[0], contracts[0], [
    { ticker:'GCZ6', session_end_date:'2026-11-06', close:4000, volume:120 },
    { ticker:'GCZ6', session_end_date:'2026-11-05', close:3980, volume:100 },
    { ticker:'GCZ6', session_end_date:'2026-11-07', close:4010, volume:150 }
  ]);
  assert.equal(quote.available,true);
  assert.equal(quote.close,'4010');
  assert.equal(quote.previous_close,'4000');
  assert.equal(quote.change,'10.000000');
  assert.equal(quote.percent_change,'0.2500');
  assert.equal(quote.source,'Massive Futures');
  assert.equal(quote.delayed,true);
  assert.equal(quote.delayHours,8);
  assert.equal(quote.contract,'GCZ6');

  const unavailable = normalizeFuturesQuote(FUTURES_PRODUCTS[0], contracts[0], []);
  assert.equal(unavailable.available,false);
  assert.ok(unavailable.error);
  console.log('PASS: contract selection, expired/combined/inactive contract filtering, OHLC session normalization and explicit 8-hour delay metadata');
} finally {
  rmSync(out,{recursive:true,force:true});
}
