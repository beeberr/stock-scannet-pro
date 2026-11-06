import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const out = '.tmp-paper-test';
const compile = spawnSync('npx', ['tsc','src/paperTrading.ts','--target','ES2020','--module','ES2020','--outDir',out,'--strict','--skipLibCheck'], { encoding:'utf8' });
if (compile.status !== 0) {
  process.stderr.write(compile.stdout + compile.stderr);
  process.exit(compile.status ?? 1);
}
const ledger = await import(new URL('../' + out + '/paperTrading.js', import.meta.url));
const { createDefaultAccounts, executeTrade, getOpenCostBasis, getRealizedPnl, loadAccounts } = ledger;
try {
  let account = createDefaultAccounts()[0];
  account = executeTrade(account,{symbol:'AAPL',side:'BUY',quantity:2,price:100,fees:2}).account;
  assert.equal(account.cash,9798);
  assert.equal(account.positions[0].quantity,2);
  assert.equal(account.positions[0].averageCost,101);
  account = executeTrade(account,{symbol:'AAPL',side:'BUY',quantity:1,price:110,fees:1}).account;
  assert.equal(account.positions[0].quantity,3);
  assert.equal(account.positions[0].averageCost,104.333333);
  assert.equal(getOpenCostBasis(account),313);
  const sale = executeTrade(account,{symbol:'AAPL',side:'SELL',quantity:1,price:120,fees:2});
  account = sale.account;
  assert.equal(sale.realizedPnl,13.67);
  assert.equal(account.cash,9805);
  assert.equal(account.positions[0].quantity,2);
  assert.equal(getRealizedPnl(account),13.67);
  assert.throws(()=>executeTrade(account,{symbol:'AAPL',side:'SELL',quantity:3,price:120}),/אין מספיק יחידות/);
  assert.throws(()=>executeTrade(createDefaultAccounts()[0],{symbol:'TSLA',side:'BUY',quantity:100,price:200}),/אין יתרת מזומן/);
  assert.throws(()=>executeTrade(account,{symbol:'',side:'BUY',quantity:1,price:10}),/סימול/);
  const migrated = loadAccounts(JSON.stringify([{name:'old A',balance:9876,trades:[{id:1,symbol:'CL',side:'קנייה',amount:124,date:'2026-01-01'}]},{name:'old B',balance:10000,trades:[]}]));
  assert.equal(migrated[0].cash,9876);
  assert.equal(migrated[0].trades[0].side,'LEGACY');
  assert.equal(migrated[0].trades[0].legacyAmount,124);
  console.log('PASS: buys, weighted average cost, fees, realized P&L, sell limits, cash limits, validation and legacy migration');
} finally {
  rmSync(out,{recursive:true,force:true});
}
