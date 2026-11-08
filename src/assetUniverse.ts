export const MAX_TRACKED_ASSETS = 50;
export const DYNAMIC_WATCH_SLOTS = 5;

// 45 fixed research assets + 5 reserved slots. The server and UI share this registry.
export const ASSET_UNIVERSE = [
  // 20 equities
  ['AAPL', 'Apple', 'מניה', 'קצר וארוך'],
  ['MSFT', 'Microsoft', 'מניה', 'ארוך'],
  ['NVDA', 'NVIDIA', 'מניה', 'קצר וארוך'],
  ['AMZN', 'Amazon', 'מניה', 'קצר וארוך'],
  ['GOOGL', 'Alphabet', 'מניה', 'ארוך'],
  ['META', 'Meta Platforms', 'מניה', 'קצר וארוך'],
  ['AVGO', 'Broadcom', 'מניה', 'קצר וארוך'],
  ['TSLA', 'Tesla', 'מניה', 'קצר וארוך'],
  ['BRK.B', 'Berkshire Hathaway', 'מניה', 'ארוך'],
  ['JPM', 'JPMorgan Chase', 'מניה', 'ארוך'],
  ['LLY', 'Eli Lilly', 'מניה', 'ארוך'],
  ['WMT', 'Walmart', 'מניה', 'ארוך'],
  ['XOM', 'Exxon Mobil', 'מניה', 'קצר וארוך'],
  ['CVX', 'Chevron', 'מניה', 'קצר וארוך'],
  ['COST', 'Costco', 'מניה', 'ארוך'],
  ['AMD', 'AMD', 'מניה', 'קצר וארוך'],
  ['ORCL', 'Oracle', 'מניה', 'קצר וארוך'],
  ['NFLX', 'Netflix', 'מניה', 'קצר וארוך'],
  ['PLTR', 'Palantir', 'מניה', 'קצר וארוך'],
  ['CRM', 'Salesforce', 'מניה', 'ארוך'],
  // 8 commodities
  ['GC', 'זהב', 'סחורה', 'קצר וארוך'],
  ['SI', 'כסף', 'סחורה', 'קצר'],
  ['HG', 'נחושת', 'סחורה', 'קצר'],
  ['CL', 'נפט WTI', 'סחורה', 'קצר וארוך'],
  ['NG', 'גז טבעי', 'סחורה', 'קצר'],
  ['ZC', 'תירס', 'סחורה', 'קצר'],
  ['PL', 'פלטינה', 'סחורה', 'קצר'],
  ['PA', 'פלדיום', 'סחורה', 'קצר'],
  // 8 indices
  ['SPX', 'S&P 500', 'מדד', 'ארוך'],
  ['NDX', 'Nasdaq 100', 'מדד', 'קצר וארוך'],
  ['DJI', 'Dow Jones', 'מדד', 'ארוך'],
  ['RUT', 'Russell 2000', 'מדד', 'קצר וארוך'],
  ['VIX', 'מדד תנודתיות VIX', 'מדד', 'קצר'],
  ['FTSE', 'FTSE 100', 'מדד', 'ארוך'],
  ['DAX', 'DAX 40', 'מדד', 'קצר וארוך'],
  ['N225', 'Nikkei 225', 'מדד', 'ארוך'],
  // 9 ETFs
  ['SPY', 'SPDR S&P 500 ETF', 'קרן סל', 'קצר וארוך'],
  ['QQQ', 'Invesco QQQ', 'קרן סל', 'קצר וארוך'],
  ['DIA', 'SPDR Dow Jones ETF', 'קרן סל', 'ארוך'],
  ['IWM', 'iShares Russell 2000', 'קרן סל', 'קצר וארוך'],
  ['GLD', 'SPDR Gold Shares', 'קרן סל', 'קצר וארוך'],
  ['SLV', 'iShares Silver Trust', 'קרן סל', 'קצר'],
  ['USO', 'United States Oil Fund', 'קרן סל', 'קצר'],
  ['XLE', 'Energy Select Sector SPDR', 'קרן סל', 'קצר וארוך'],
  ['TLT', 'iShares 20+ Year Treasury', 'קרן סל', 'ארוך']
] as const;

export const CURRENTLY_CONNECTED_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'XLE', 'GC', 'SI', 'HG', 'CL'] as const;

if (ASSET_UNIVERSE.length + DYNAMIC_WATCH_SLOTS !== MAX_TRACKED_ASSETS) {
  throw new Error('Asset universe must reserve exactly five dynamic slots within the 50-asset cap.');
}
if (new Set(ASSET_UNIVERSE.map(([symbol]) => symbol)).size !== ASSET_UNIVERSE.length) {
  throw new Error('Asset universe contains duplicate symbols.');
}
