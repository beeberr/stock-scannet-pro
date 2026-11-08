import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL ?? 'https://stock-scannet-pro.china2sell.workers.dev';
const browser = await chromium.launch({ headless: true });
const errors = [];
const failedAssets = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
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
  await page.getByRole('heading', { name: 'סקירה' }).waitFor({ state: 'visible', timeout: 10000 });

  const assets = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => entry.name)
    .filter(url => url.startsWith(location.origin)));
  if (!assets.some(url => /\.js(?:\?|$)/.test(url))) throw new Error('No application JavaScript bundle was loaded.');
  if (!assets.some(url => /\.css(?:\?|$)/.test(url))) throw new Error('No application CSS bundle was loaded.');

  await page.getByRole('button', { name: /סורק/ }).first().click();
  await page.getByRole('heading', { name: 'סורק' }).waitFor({ state: 'visible', timeout: 10000 });
  const search = page.getByPlaceholder('חפש לפי שם או סימול');
  await search.fill('AAPL');
  await page.getByText('AAPL', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });

  if (failedAssets.length) throw new Error('Same-origin asset requests failed: ' + failedAssets.join('; '));
  if (errors.length) throw new Error('Browser JavaScript/console errors: ' + errors.join('; '));
  console.log('PASS browser smoke test: React UI rendered, JavaScript and CSS loaded, navigation and scanner search worked; no browser errors.');
} finally {
  await browser.close();
}
