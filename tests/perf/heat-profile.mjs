// Heat / battery profile: how much work the app does while idle, scrolling and typing.
// Uses Chrome's own counters (Performance.getMetrics) + running animations + paint counts.
// Run: node tests/perf/heat-profile.mjs   (prints a table; writes test-results/heat-profile.json)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const server = await startServer(path.join(ROOT, 'dist'), 0, { base: '/bookly.v2/' });
const base = `http://127.0.0.1:${server.address().port}/bookly.v2/?fastAI=1&noIntro=1`;
const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
// Simulate a mid-range phone CPU.
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const go = (h) => page.evaluate((x) => { location.hash = x; }, h);

async function measure(label, ms, action) {
  await page.waitForTimeout(1500); // let page-in animations finish
  // count frames the compositor actually produced (paint/composite) via the frame counter
  await browser.startTracing(page, { categories: ['toplevel', 'viz', 'gpu', 'cc', 'disabled-by-default-devtools.timeline'] });
  const a = await metrics();
  const t0 = Date.now();
  if (action) await action(); else await page.waitForTimeout(ms);
  const dt = (Date.now() - t0) / 1000;
  const b = await metrics();
  const trace = JSON.parse((await browser.stopTracing()).toString());
  // Busy time of every thread in every Chrome process (renderer, compositor, raster, GPU, viz).
  let busyUs = 0;
  for (const e of trace.traceEvents) {
    if (e.ph !== 'X' || !e.dur) continue;
    if (e.name === 'ThreadControllerImpl::RunTask' || e.name === 'RunTask') busyUs += e.dur;
  }
  const info = await page.evaluate(() => {
    const anims = document.getAnimations().filter((x) => x.playState === 'running');
    const infinite = anims.filter((x) => x.effect?.getTiming().iterations === Infinity);
    const blur = [...document.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none'); });
    const visBlur = blur.filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; });
    return { infinite: infinite.map((x) => x.effect?.target?.className?.toString?.().split(' ')[0] || x.animationName).slice(0, 6), running: anims.length, blur: blur.length, visBlur: visBlur.length };
  });
  const row = {
    label,
    cpuPct: Math.round(((b.TaskDuration - a.TaskDuration) / dt) * 1000) / 10,
    allThreadsPct: Math.round(busyUs / 1e4 / dt) / 1,
    scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
    layouts: b.LayoutCount - a.LayoutCount,
    styles: b.RecalcStyleCount - a.RecalcStyleCount,
    ...info,
  };
  console.log(JSON.stringify(row));
  return row;
}

const rows = [];
await page.goto(base);
await page.waitForSelector('.home');
// a realistic library: create a few books through the app
for (let i = 0; i < 3; i++) {
  await go('#/create');
  await page.fill('[data-testid=creator-topic]', `Issiqlik sinovi ${i + 1}`);
  await page.click('[data-testid=creator-outline]');
  await page.waitForSelector('[data-testid=outline-list] li');
  await page.click('[data-testid=creator-write]');
  await page.waitForFunction(() => document.querySelectorAll('.gen-item.is-done').length === document.querySelectorAll('.gen-item').length, null, { timeout: 60000 });
  await page.click('[data-testid=creator-save-edit]');
  await page.waitForSelector('[data-testid=editor]');
}
const bookUrl = await page.evaluate(() => location.hash);

for (const [label, hash] of [['home idle', '#/'], ['library idle', '#/books'], ['studio idle', '#/studio'], ['profile idle', '#/profile'], ['about idle', '#/about'], ['editor idle', bookUrl]]) {
  await go(hash); await page.waitForTimeout(300);
  rows.push(await measure(label, 6000));
}
for (const [label, hash] of [['library scroll', '#/books'], ['about scroll', '#/about']]) {
  await go(hash); await page.waitForTimeout(300);
  rows.push(await measure(label, 0, async () => {
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, i % 15 < 8 ? 120 : -120); await page.waitForTimeout(100); }
  }));
}
const bookId = bookUrl.split('/')[2].split('?')[0];
await go(`#/reader/${bookId}`);
await page.waitForSelector('.reader-progress');
rows.push(await measure('reader scroll', 0, async () => {
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, i < 25 ? 90 : -90); await page.waitForTimeout(80); }
}));
await go(bookUrl);
await page.waitForSelector('[data-testid=editor] [contenteditable=true]');
rows.push(await measure('editor typing 120 chars', 0, async () => {
  const el = page.locator('[data-testid=editor] [contenteditable=true]').first();
  await el.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Bu matn issiqlik sinovi uchun yozilmoqda, telefon qizimasligi kerak va ilova tez ishlashi lozim. Yana bir oz.', { delay: 45 });
}));

fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'test-results', 'heat-profile.json'), JSON.stringify(rows, null, 2));
await browser.close(); server.close();
