import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const port = Number(process.argv[2] || 9876);
const baseUrl = process.argv[3] || 'http://127.0.0.1:8767';
const screenshotPath = resolve(process.argv[4] || '.tmp/desktop-mobile-cdp.png');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && item.url === `${baseUrl}/desktop.html`);
if (!target) throw new Error('Could not find the isolated RHODA app page on the local CDP endpoint.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve: accept, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else accept(message.result);
});
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((accept, reject) => {
    pending.set(id, { resolve: accept, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

try {
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const metrics = await evaluate(`(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    cards: document.querySelectorAll('.workspace-card').length,
    cardsOverflowing: [...document.querySelectorAll('.workspace-card')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).length,
    navOverflowing: document.querySelector('nav').getBoundingClientRect().right > innerWidth + 1,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
    title: document.querySelector('h1')?.innerText,
  }))()`);
  await mkdir(dirname(screenshotPath), { recursive: true });
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  if (metrics.viewport.width !== 390 || metrics.cards !== 6 || metrics.cardsOverflowing || metrics.navOverflowing || metrics.horizontalOverflow)
    throw new Error(`Mobile layout assertion failed: ${JSON.stringify(metrics)}`);
  console.log(JSON.stringify({ metrics, screenshot: screenshotPath }, null, 2));
} finally {
  try { await cdp('Emulation.clearDeviceMetricsOverride'); } catch {}
  socket.close();
}
