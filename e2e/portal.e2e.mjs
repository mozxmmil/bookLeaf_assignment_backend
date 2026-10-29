/**
 * End-to-end test of both portals in a real browser (Playwright).
 * Prereqs: API on :4000 and web on :3000 with a freshly seeded DB.
 *   node e2e/portal.e2e.mjs            (SHOTS=1 to save screenshots into e2e/screenshots)
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS === '1';
const shotDir = fileURLToPath(new URL('./screenshots/', import.meta.url)); // pathname breaks on Windows (/C:/...)
if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['✅', name]); console.log('✅', name); }
  catch (e) { results.push(['❌', name]); console.log('❌', name, '\n   ', e.message.split('\n')[0]); }
}
const shot = (page, name) => SHOTS && page.screenshot({ path: `${shotDir}${name}.png`, fullPage: true });

async function login(ctx, email, password) {
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  return page;
}

const authorCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const adminCtx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
let author, admin, ticketUrl;
const SUBJECT = `E2E: royalty missing ${Date.now()}`;

await step('wrong password shows an error', async () => {
  const p = await login(authorCtx, 'priya.sharma@email.com', 'wrong');
  await p.locator('form [role=alert]').waitFor();
  assert.match(await p.locator('form [role=alert]').innerText(), /Invalid email or password/);
  await shot(p, '01-login-error');
  await p.close();
});

await step('author logs in and sees only own books with royalty figures', async () => {
  author = await login(authorCtx, 'priya.sharma@email.com', 'author123');
  await author.waitForURL('**/author/books');
  await author.getByTestId('book-card').first().waitFor();
  const titles = await author.locator('[data-testid=book-card] h2').allInnerTexts();
  assert.deepEqual(titles.sort(), ['The Saffron Diaries', 'Whispers of the Ganges']);
  const body = await author.locator('main').innerText();
  assert.match(body, /₹3,570/); // total pending 3,570 + 0
  await shot(author, '02-author-books');
});

await step('author with a book in production sees stage, not zero royalties', async () => {
  const ctx = await browser.newContext();
  const p = await login(ctx, 'kavita.deshmukh@email.com', 'author123');
  await p.waitForURL('**/author/books');
  await p.getByText('Currently in').waitFor();
  assert.match(await p.locator('main').innerText(), /Typesetting/);
  await shot(p, '03-author-production-book');
  await ctx.close();
});

await step('author cannot open admin pages (redirected)', async () => {
  const p = await authorCtx.newPage();
  await p.goto(`${WEB}/admin/tickets`);
  await p.waitForURL('**/author/books');
  await p.close();
});

await step('empty ticket list shows a helpful empty state', async () => {
  const ctx = await browser.newContext();
  const p = await login(ctx, 'rohit.kapoor@email.com', 'author123'); // author with no tickets
  await p.waitForURL('**/author/books');
  await p.goto(`${WEB}/author/tickets`);
  await p.getByText("You haven't raised any queries yet").waitFor();
  await ctx.close();
});

await step('ticket form validates input', async () => {
  await author.goto(`${WEB}/author/tickets/new`);
  await author.click('button[type=submit]');
  await author.locator('.field-error', { hasText: /Subject must be at least/ }).waitFor();
  await shot(author, '04-ticket-validation');
});

await step('author raises a ticket about a specific book', async () => {
  await author.goto(`${WEB}/author/tickets/new?bookId=BK001`);
  await author.locator('#book option[value=BK001]').waitFor({ state: 'attached' }); // books load async
  assert.equal(await author.inputValue('#book'), 'BK001');
  await author.fill('#subject', SUBJECT);
  await author.fill('#description', "I haven't received any royalty for 6 months even though the dashboard shows a pending amount. Please check.");
  await author.click('button[type=submit]');
  await author.waitForURL(/\/author\/tickets\/\d+\?created=1/);
  ticketUrl = author.url().split('?')[0];
  await author.getByText("we've received your query").waitFor();
  await shot(author, '05-author-ticket-created');
});

await step('admin sees the ticket at the top, auto-classified Critical (rules fallback)', async () => {
  admin = await login(adminCtx, 'admin@bookleaf.com', 'admin123');
  await admin.waitForURL('**/admin/tickets');
  const row = admin.getByTestId('queue-row').filter({ hasText: SUBJECT });
  await row.waitFor();
  await row.getByText('Critical').waitFor({ timeout: 8000 });
  await row.getByText('Royalty & Payments').waitFor();
  const firstRow = await admin.getByTestId('queue-row').first().innerText();
  assert.match(firstRow, /Critical/);
  await shot(admin, '06-admin-queue');
});

await step('queue filters by priority', async () => {
  await admin.getByLabel('Priority').selectOption('LOW');
  await admin.getByText('Can I update my author bio?').waitFor();
  const rows = await admin.getByTestId('queue-row').allInnerTexts();
  assert.ok(rows.every((r) => /Low/.test(r)));
  await admin.getByRole('button', { name: 'Reset filters' }).click();
});

await step('admin opens ticket: AI unavailable banner → manual reply mode', async () => {
  await admin.getByTestId('queue-row').filter({ hasText: SUBJECT }).getByRole('link').click();
  await admin.getByTestId('ai-unavailable').waitFor({ timeout: 10000 });
  assert.match(await admin.getByTestId('context-panel').innerText(), /₹3,570/); // book context panel (Priya, BK001)
});

await step('admin overrides priority and adds an internal note', async () => {
  await admin.getByLabel('Priority').selectOption('HIGH');
  await admin.getByText('edited').first().waitFor();
  await admin.getByLabel('New internal note').fill('Bank IFSC missing on profile — confirm with finance');
  await admin.getByRole('button', { name: 'Add note' }).click();
  await admin.getByText('Bank IFSC missing').waitFor();
  await admin.getByRole('button', { name: 'Assign to me' }).click();
  await admin.getByTestId('context-panel').getByText('Aisha (Support Lead)').waitFor();
  await shot(admin, '07-admin-ticket-workspace');
});

await step('admin reply appears on author page in real time (no refresh)', async () => {
  await author.goto(ticketUrl);
  await author.getByTestId('msg-author').first().waitFor();
  await author.getByText('Live').waitFor({ timeout: 8000 });
  const reply = 'Hi Priya, I am sorry for the delay. Our team will check your payout and get back within 48 hours.';
  await admin.fill('#reply', reply);
  await admin.getByRole('button', { name: 'Send reply' }).click();
  await author.getByTestId('msg-bookleaf').waitFor({ timeout: 8000 }); // arrives via SSE
  assert.match(await author.getByTestId('msg-bookleaf').innerText(), /within 48 hours/);
  assert.match(await author.getByTestId('status-badge').innerText(), /In Progress/);
  await shot(author, '08-author-sees-reply-live');
});

await step('internal note is NOT visible to the author', async () => {
  assert.doesNotMatch(await author.locator('main').innerText(), /IFSC/);
});

await step('author follow-up shows up for admin live', async () => {
  await author.fill('#reply', 'Thank you! My bank details are updated now.');
  await author.getByRole('button', { name: 'Send' }).click();
  await admin.getByText('My bank details are updated now').waitFor({ timeout: 8000 });
});

await step('admin resolves the ticket; author sees status change live', async () => {
  await admin.getByLabel('Status').selectOption('RESOLVED');
  await author.getByTestId('status-badge').filter({ hasText: 'Resolved' }).waitFor({ timeout: 8000 });
});

await step('author ticket list shows the reply count', async () => {
  await author.goto(`${WEB}/author/tickets`);
  await author.getByTestId('ticket-row').filter({ hasText: SUBJECT }).getByText('1 reply').waitFor();
  await shot(author, '09-author-ticket-list');
});

await step('mobile layout renders without horizontal overflow', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await login(ctx, 'priya.sharma@email.com', 'author123');
  await p.waitForURL('**/author/books');
  await p.getByTestId('book-card').first().waitFor();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false);
  await shot(p, '10-mobile-books');
  await ctx.close();
});

await browser.close();
const failed = results.filter((r) => r[0] === '❌').length;
console.log(`\n${results.length - failed}/${results.length} E2E checks passed`);
process.exit(failed ? 1 : 0);
