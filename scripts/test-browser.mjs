import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL ?? 'https://stock-scannet-pro.china2sell.workers.dev';
const browser = await chromium.launch({ headless: true });
const errors = [];
const failedAssets = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && message.location().url.startsWith(baseUrl)) errors.push(message.text());
  });
  page.on('requestfailed', request => {
    if (request.url().startsWith(baseUrl)) failedAssets.push(request.url() + ' — ' + (request.failure()?.errorText ?? 'request failed'));
  });
  page.on('response', response => {
    if (response.url().startsWith(baseUrl) && response.status() >= 400) {
      failedAssets.push(response.url() + ' — HTTP ' + response.status());
    }
  });

  const response = await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 45000 });
  if (!response?.ok()) throw new Error('Homepage did not return a successful response.');
  await page.locator('#root').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByText('STOCK SCANNER', { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('heading', { name: 'מרכז הבקרה', exact: true }).waitFor({ state: 'visible', timeout: 10000 });

  const assets = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => entry.name)
    .filter(url => url.startsWith(location.origin)));
  if (!assets.some(url => /\.js(?:\?|$)/.test(url))) throw new Error('No application JavaScript bundle was loaded.');
  if (!assets.some(url => /\.css(?:\?|$)/.test(url))) throw new Error('No application CSS bundle was loaded.');

  await page.getByRole('link', { name: 'סורק', exact: true }).click();
  const scanner = page.locator('#scanner');
  await scanner.getByRole('heading', { name: 'סורק נכסים', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  const search = scanner.getByPlaceholder('חפש לפי שם או סימול');
  await search.fill('AAPL');
  await scanner.getByText('AAPL', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });

  const statusResponse = await page.request.get(new URL('/api/external/status', baseUrl).toString());
  if (!statusResponse.ok()) throw new Error('External engine status endpoint failed: HTTP ' + statusResponse.status());
  const externalStatus = await statusResponse.json();
  const checks = [
    { id: 'alphasift', feed: externalStatus.alphasift, labels: { READY: 'תוצאות זמינות', WAITING: 'ממתין לפרסום', UNAVAILABLE: 'מקור לא זמין' } },
    { id: 'dsa', feed: externalStatus.dsa, labels: { READY: 'תוצאות פורסמו', WAITING: 'ממתין לריצה ראשונה', UNAVAILABLE: 'מקור לא זמין' } }
  ];
  for (const check of checks) {
    const expected = check.labels[check.feed?.status];
    if (!expected) throw new Error('Unknown external engine status for ' + check.id + '.');
    const selector = '#' + check.id + ' .engine-status';
    await page.waitForFunction(({ selector, expected }) => {
      const element = document.querySelector(selector);
      return element?.textContent?.trim() === expected;
    }, { selector, expected }, { timeout: 15000 });
  }

  if (failedAssets.length) throw new Error('Same-origin requests failed: ' + failedAssets.join('; '));
  if (errors.length) throw new Error('Browser JavaScript/console errors: ' + errors.join('; '));
  console.log('PASS browser smoke test: one-page dashboard, navigation, scanner search and external READY/WAITING/UNAVAILABLE labels match the status API; no browser errors.');
} finally {
  await browser.close();
}
