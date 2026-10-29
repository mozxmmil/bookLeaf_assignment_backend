/**
 * E2E for the AI happy path. Run the API with:
 *   GEMINI_API_KEY=fake-key GEMINI_BASE_URL=http://localhost:4999/v1beta/models  (and node e2e/fake-gemini.mjs)
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
let ok = 0, fail = 0;
async function step(name, fn) { try { await fn(); ok++; console.log('✅', name); } catch (e) { fail++; console.log('❌', name, '\n   ', e.message.split('\n')[0]); } }
async function login(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } }); const p = await ctx.newPage();
  await p.goto(`${WEB}/login`); await p.fill('#email', email); await p.fill('#password', password); await p.click('button[type=submit]');
  return p;
}
const author = await login('priya.sharma@example.com', 'author123');
await author.waitForURL('**/author/books');
const SUBJECT = `AI path ${Date.now()}`;
let url;
await step('author creates ticket', async () => {
  await author.goto(`${WEB}/author/tickets/new?bookId=BK001`);
  await author.locator('#book option[value=BK001]').waitFor({ state: 'attached' });
  await author.fill('#subject', SUBJECT);
  await author.fill('#description', 'My royalty payment for last quarter has not arrived yet. Can you check?');
  await author.click('button[type=submit]');
  await author.waitForURL(/created=1/); url = author.url().split('?')[0];
});
const admin = await login('admin@bookleaf.com', 'admin123');
await admin.waitForURL('**/admin/tickets');
await step('LLM classification shows with AI tag', async () => {
  const row = admin.getByTestId('queue-row').filter({ hasText: SUBJECT });
  await row.getByText('High').waitFor({ timeout: 8000 });
  await row.getByRole('link').click();
  await admin.getByTestId('context-panel').getByText('AI', { exact: true }).first().waitFor();
});
await step('AI draft auto-loads with real facts (pending amount + payout date)', async () => {
  await admin.getByText('AI draft — review before sending').waitFor({ timeout: 10000 });
  const draft = await admin.inputValue('#reply');
  assert.match(draft, /₹13,210/);
  assert.match(draft, /14 November 2026|November/);
  await admin.screenshot({ path: new URL('./screenshots/11-admin-ai-draft.png', import.meta.url).pathname, fullPage: false });
});
await step('admin edits draft and sends; marked AI-assisted; author receives live', async () => {
  await author.goto(url); await author.getByText('Live').waitFor({ timeout: 8000 });
  await admin.fill('#reply', (await admin.inputValue('#reply')).replace('Hi Priya,', 'Hi Priya, thanks for reaching out.'));
  await admin.getByRole('button', { name: 'Send reply' }).click();
  await admin.getByText('AI-assisted').waitFor({ timeout: 8000 });
  await author.getByTestId('msg-bookleaf').waitFor({ timeout: 8000 });
  assert.match(await author.getByTestId('msg-bookleaf').innerText(), /thanks for reaching out/);
  assert.doesNotMatch(await author.locator('main').innerText(), /AI-assisted/);
});
await browser.close();
console.log(`\n${ok}/${ok + fail} AI E2E checks passed`); process.exit(fail ? 1 : 0);
