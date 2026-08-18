import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const outputDir = path.resolve('.moss-eval', 'env-check');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const consoleMessages = [];
  page.on('console', (message) => consoleMessages.push(`${message.type()}:${message.text()}`));
  await page.setContent(`
    <form id="form">
      <input id="name" required>
      <button>Submit</button>
      <output id="state">empty</output>
    </form>
    <script>
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        state.textContent = 'loading';
        console.log('state:loading');
        await new Promise((resolve) => setTimeout(resolve, 25));
        state.textContent = 'success';
        console.log('state:success');
      });
    </script>
  `);
  await page.locator('#name').fill('moss-eval');
  await page.locator('button').click();
  await page.locator('#state').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'success');
  const state = await page.locator('#state').textContent();
  if (state !== 'success' || !consoleMessages.includes('log:state:success')) {
    throw new Error(`browser state verification failed: ${state}`);
  }
  const screenshot = path.join(outputDir, 'browser-check.png');
  await page.screenshot({ path: screenshot });
  process.stdout.write(`${JSON.stringify({ ready: true, engine: 'chromium', state, screenshot })}\n`);
} finally {
  await browser.close();
}
