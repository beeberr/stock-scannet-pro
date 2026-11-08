export const FUTURES_PRODUCTS = [
  { key: 'GC', productCode: 'GC', label: 'זהב', exchange: 'COMEX' },
  { key: 'SI', productCode: 'SI', label: 'כסף', exchange: 'COMEX' },
  { key: 'HG', productCode: 'HG', label: 'נחושת', exchange: 'COMEX' },
  { key: 'CL', productCode: 'CL', label: 'נפט WTI', exchange: 'NYMEX' }
] as const;

export interface FuturesContract {
  ticker?: string;
  product_code?: string;
  active?: boolean;
  type?: string;
  days_to_maturity?: number;
  last_trade_date?: string;
}

export interface FuturesAggregate {
  ticker?: string;
  session_end_date?: string;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  window_start?: number;
}

export function selectFrontContract(
  contracts: readonly FuturesContract[],
  productCode: string,
  minimumDaysToMaturity = 14
): FuturesContract | null {
  const code = productCode.trim().toUpperCase();
  if (!code) throw new Error('קוד מוצר חסר');
  if (!Number.isInteger(minimumDaysToMaturity) || minimumDaysToMaturity < 0) {
    throw new Error('מרווח הפקיעה חייב להיות מספר שלם שאינו שלילי');
  }

  const contractPattern = new RegExp('^' + code + '[FGHJKMNQUVXZ]\\d{1,2}$');
  const candidates = contracts.filter(contract =>
    contract.product_code?.toUpperCase() === code &&
    contract.active === true &&
    contract.type === 'single' &&
    typeof contract.ticker === 'string' &&
    contractPattern.test(contract.ticker.toUpperCase()) &&
    Number.isFinite(contract.days_to_maturity) &&
    (contract.days_to_maturity as number) >= minimumDaysToMaturity &&
    typeof contract.last_trade_date === 'string'
  );

  candidates.sort((a, b) =>
    (a.days_to_maturity as number) - (b.days_to_maturity as number)
  );
  return candidates[0] ?? null;
}

export function normalizeFuturesQuote(
  product: typeof FUTURES_PRODUCTS[number],
  contract: FuturesContract,
  aggregates: readonly FuturesAggregate[]
) {
  const valid = aggregates
    .filter(bar =>
      typeof bar.session_end_date === 'string' &&
      Number.isFinite(Date.parse(bar.session_end_date)) &&
      Number.isFinite(bar.close) && (bar.close as number) > 0
    )
    .slice()
    .sort((a, b) => Date.parse(a.session_end_date as string) - Date.parse(b.session_end_date as string));

  const latest = valid[valid.length - 1];
  const previous = valid.length > 1 ? valid[valid.length - 2] : undefined;
  if (!latest || !contract.ticker) {
    return {
      label: product.label,
      productCode: product.productCode,
      exchange: product.exchange,
      symbol: contract.ticker,
      available: false,
      source: 'Massive Futures',
      error: 'לא התקבלו נרות מסחר תקינים עבור החוזה שנבחר'
    };
  }

  const price = latest.close as number;
  const previousClose = previous?.close;
  const change = Number.isFinite(previousClose) ? price - (previousClose as number) : null;
  const percent = change !== null && (previousClose as number) > 0
    ? change / (previousClose as number) * 100
    : null;

  return {
    label: product.label,
    productCode: product.productCode,
    exchange: product.exchange,
    symbol: contract.ticker,
    contract: contract.ticker,
    lastTradeDate: contract.last_trade_date,
    daysToMaturity: contract.days_to_maturity,
    price: String(price),
    close: String(price),
    previous_close: previousClose === undefined ? undefined : String(previousClose),
    change: change === null ? undefined : change.toFixed(6),
    percent_change: percent === null ? undefined : percent.toFixed(4),
    volume: latest.volume,
    currency: 'USD',
    datetime: latest.session_end_date + 'T00:00:00.000Z',
    sessionDate: latest.session_end_date,
    available: true,
    delayed: true,
    delayHours: 8,
    quoteType: 'historical-session-close',
    source: 'Massive Futures',
    rollPolicy: 'החוזה הפעיל הקרוב לפקיעה עם מרווח של 14 ימים לפחות; לא נבחר לפי נפח מסחר'
  };
}
