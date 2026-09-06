/**
 * Drives the built page in a headless browser and prints what a stranger
 * would get: load time, the tag line, retrieved titles for two topics, the
 * live tokens with their salience, and whether anything fires on a timer.
 * Screenshots land in the working directory.
 *
 * Playwright is deliberately not a dependency of this repo — it is a
 * verification tool, not part of the build. Run it from a scratch directory:
 *
 *   npm i playwright && npx playwright install chromium
 *   node /path/to/tools/verify-live.mjs https://generaljudas.github.io/lucidBrowser/
 *
 * With no argument it drives http://localhost:4173/ (`npm run preview` in app/).
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: 'm2-0-loading.png' });
await page.evaluate(() => window.riptide.ready);
console.log('LOADED_MS:', Date.now() - t0);
console.log('TAG:', await page.locator('#tag').textContent());
console.log('PROMPT_DISABLED:', await page.locator('#prompt').isDisabled());
await page.screenshot({ path: 'm2-1-ready.png' });

const titles = () => page.locator('#results .hit b').allTextContents();
const fires = () => page.evaluate(() => window.riptide.getState().fireCount);

async function type(words) {
  for (const w of words) {
    await page.keyboard.type(w + ' ', { delay: 70 });
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(400);
}

// One topic, typed at a human pace.
await type(['the', 'glacier', 'melts', 'slowly', 'in', 'summer']);
console.log('AFTER_GLACIER fires=%d titles=%j', await fires(), await titles());
await page.screenshot({ path: 'm2-2-glacier.png' });

// A change of subject should fire and replace the pane.
await type(['and', 'then', 'a', 'jazz', 'saxophone', 'solo']);
console.log('AFTER_JAZZ fires=%d titles=%j', await fires(), await titles());
await page.screenshot({ path: 'm2-3-jazz.png' });

// An unknown word must still appear as a token, at the bundle's OOV salience.
await page.keyboard.type('zzqxv ', { delay: 70 });
await page.waitForTimeout(300);
console.log(
  'LIVE_TOKENS:',
  JSON.stringify(
    await page.evaluate(() =>
      window.riptide
        .getState()
        .tokens.map((t) => [t.text, Math.hypot(...t.vector).toFixed(3)]),
    ),
  ),
);

// Nothing may fire on a timer; only drift, including drift caused by deaths.
const before = await fires();
await page.waitForTimeout(3000);
console.log('IDLE_FIRES_DELTA:', (await fires()) - before);
await page.screenshot({ path: 'm2-4-idle.png' });

// Narrow viewport: the results stack below the field.
await page.setViewportSize({ width: 420, height: 800 });
await page.waitForTimeout(300);
await page.screenshot({ path: 'm2-5-narrow.png' });

console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors));
await browser.close();
