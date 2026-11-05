export type TradeSide = 'BUY' | 'SELL';

export interface Position {
  symbol: string;
  quantity: number;
  averageCost: number;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  side: TradeSide | 'LEGACY';
  quantity: number;
  price: number;
  fees: number;
  financing: number;
  date: string;
  note: string;
  realizedPnl: number | null;
  legacyAmount?: number;
}

export interface PaperAccount {
  name: string;
  initialCapital: number;
  cash: number;
  positions: Position[];
  trades: PaperTrade[];
}

export interface TradeInput {
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fees?: number;
  financing?: number;
  date?: string;
  note?: string;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const quantityRound = (value: number) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;

export function createDefaultAccounts(): PaperAccount[] {
  return [
    { name: 'דמו A · מסחר קצר', initialCapital: 10000, cash: 10000, positions: [], trades: [] },
    { name: 'דמו B · השקעות ערך', initialCapital: 10000, cash: 10000, positions: [], trades: [] }
  ];
}

/** Safely upgrades the previous balance-only localStorage format without inventing fills. */
export function loadAccounts(raw: string | null): PaperAccount[] {
  if (!raw) return createDefaultAccounts();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 2) return createDefaultAccounts();
    return parsed.map((item: any, index): PaperAccount => {
      const name = typeof item?.name === 'string' ? item.name : createDefaultAccounts()[index].name;
      const initialCapital = Number.isFinite(item?.initialCapital) ? item.initialCapital : 10000;
      const cash = Number.isFinite(item?.cash) ? item.cash : (Number.isFinite(item?.balance) ? item.balance : initialCapital);
      const positions = Array.isArray(item?.positions) ? item.positions.filter((p: any) =>
        typeof p?.symbol === 'string' && Number.isFinite(p.quantity) && p.quantity > 0 &&
        Number.isFinite(p.averageCost) && p.averageCost >= 0
      ) : [];
      const trades: PaperTrade[] = Array.isArray(item?.trades) ? item.trades.map((t: any, i: number) => {
        if (t?.side === 'BUY' || t?.side === 'SELL') return t as PaperTrade;
        return {
          id: String(t?.id ?? `legacy-${index}-${i}`),
          symbol: String(t?.symbol ?? 'לא ידוע'),
          side: 'LEGACY',
          quantity: 0,
          price: 0,
          fees: 0,
          financing: 0,
          date: String(t?.date ?? ''),
          note: String(t?.note ?? 'רישום ישן — ללא נתוני ביצוע'),
          realizedPnl: null,
          legacyAmount: Number.isFinite(t?.amount) ? t.amount : undefined
        };
      }) : [];
      return { name, initialCapital, cash: money(cash), positions, trades };
    });
  } catch {
    return createDefaultAccounts();
  }
}

export function executeTrade(account: PaperAccount, input: TradeInput): { account: PaperAccount; realizedPnl: number } {
  const symbol = input.symbol.trim().toUpperCase();
  const quantity = quantityRound(input.quantity);
  const price = money(input.price);
  const fees = money(input.fees ?? 0);
  const financing = money(input.financing ?? 0);
  if (!symbol) throw new Error('יש להזין סימול נכס');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('הכמות חייבת להיות גדולה מאפס');
  if (!Number.isFinite(price) || price <= 0) throw new Error('מחיר הביצוע חייב להיות גדול מאפס');
  if (![fees, financing].every(v => Number.isFinite(v) && v >= 0)) throw new Error('עמלות ומימון חייבים להיות אפס או יותר');

  const positions = account.positions.map(p => ({ ...p }));
  const index = positions.findIndex(p => p.symbol === symbol);
  const current = index >= 0 ? positions[index] : { symbol, quantity: 0, averageCost: 0 };
  const gross = money(quantity * price);
  const charges = money(fees + financing);
  let cash: number;
  let realizedPnl = 0;

  if (input.side === 'BUY') {
    const debit = money(gross + charges);
    if (debit > account.cash + 1e-8) throw new Error('אין יתרת מזומן מספקת לקנייה');
    const nextQuantity = quantityRound(current.quantity + quantity);
    const nextAverage = money(((current.quantity * current.averageCost) + gross + charges) / nextQuantity);
    cash = money(account.cash - debit);
    const next = { symbol, quantity: nextQuantity, averageCost: nextAverage };
    if (index >= 0) positions[index] = next; else positions.push(next);
  } else {
    if (quantity > current.quantity + 1e-8) throw new Error('אין מספיק יחידות למכירה בחשבון');
    realizedPnl = money(quantity * (price - current.averageCost) - charges);
    cash = money(account.cash + gross - charges);
    const remaining = quantityRound(current.quantity - quantity);
    if (remaining <= 1e-8) {
      if (index >= 0) positions.splice(index, 1);
    } else {
      positions[index] = { ...current, quantity: remaining };
    }
  }

  const trade: PaperTrade = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    side: input.side,
    quantity,
    price,
    fees,
    financing,
    date: input.date ?? new Date().toISOString(),
    note: input.note?.trim() ?? '',
    realizedPnl: input.side === 'SELL' ? realizedPnl : null
  };
  return { account: { ...account, cash, positions, trades: [trade, ...account.trades] }, realizedPnl };
}

export function getRealizedPnl(account: PaperAccount): number {
  return money(account.trades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0));
}

export function getOpenCostBasis(account: PaperAccount): number {
  return money(account.positions.reduce((sum, position) => sum + position.quantity * position.averageCost, 0));
}
