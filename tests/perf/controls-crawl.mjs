import path from 'node:path'; import { chromium } from 'playwright'; import { startServer } from '../../scripts/serve.mjs';
const ROOT = path.resolve(import.meta.dirname, '../..');
const server = await startServer(path.join(ROOT, 'dist'), 0, { base: '/bookly.v2/' });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const base = `http://127.0.0.1:${server.address().port}/bookly.v2/?noIntro=1`;
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.dismiss());
await page.goto(base); await page.waitForSelector('.home');
// a book with content
await page.evaluate(() => { location.hash = '#/import'; });
const txt = '# Sinov kitobi\n\n# 1-bob Kirish\n\nBirinchi paragraf matni.\n\n- bir\n- ikki\n\n> Iqtibos\n\n# 2-bob Davomi\n\nIkkinchi bob.';
await page.setInputFiles('[data-testid=import-input]', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from(txt) });
await page.waitForSelector('[data-testid=import-save]'); await page.click('[data-testid=import-save]'); await page.waitForSelector('[data-testid=editor]');
const id = await page.evaluate(() => location.hash.split('/')[2].split('?')[0]);
const pages = ['#/', '#/books', '#/studio', '#/templates', '#/profile', '#/about', '#/cloud', '#/create', '#/import', `#/editor/${id}`, `#/cover/${id}`, `#/export/${id}`, `#/reader/${id}`];
const SKIP = /clear-all|wipe|menu-delete|delete-forever|ch-delete|trash|restore-backup|signout|sign-out|logout|reset/i;
const dead = [];
for (const hash of pages) {
  await page.goto('about:blank'); await page.goto(base + hash); await page.waitForTimeout(700);
  const n = await page.locator('button:visible, a[href]:visible, [role=tab]:visible, [role=radio]:visible').count();
  for (let i = 0; i < n; i++) {
    await page.goto('about:blank'); await page.goto(base + hash); await page.waitForTimeout(450);
    const el = page.locator('button:visible, a[href]:visible, [role=tab]:visible, [role=radio]:visible').nth(i);
    if (!(await el.count())) continue;
    const info = await el.evaluate((e) => ({ tid: e.dataset.testid || '', txt: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 40), dis: e.disabled || e.getAttribute('aria-disabled') === 'true' }));
    if (info.dis || SKIP.test(info.tid + ' ' + info.txt)) continue;
    const before = await page.evaluate(() => ({ h: location.hash, html: document.body.innerHTML.length + ':' + document.querySelectorAll('*').length, ls: localStorage.getItem('bookly.settings') }));
    const e0 = errors.length;
    let dl = false; page.once('download', () => { dl = true; });
    try { await el.click({ timeout: 2500 }); } catch (e) { dead.push(`${hash} [${info.tid}] "${info.txt}": not clickable (${e.message.split('\n')[0].slice(0, 80)})`); continue; }
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ h: location.hash, html: document.body.innerHTML.length + ':' + document.querySelectorAll('*').length, ls: localStorage.getItem('bookly.settings') }));
    if (errors.length > e0) dead.push(`${hash} [${info.tid}] "${info.txt}": ERROR ${errors.slice(e0).join(' | ').slice(0, 200)}`);
    else if (!dl && before.h === after.h && before.html === after.html && before.ls === after.ls) dead.push(`${hash} [${info.tid}] "${info.txt}": nothing happened`);
  }
}
console.log(dead.join('\n') || 'no dead controls');
console.log('errors total', errors.length, [...new Set(errors)].slice(0, 10).join('\n'));
await browser.close(); server.close();
