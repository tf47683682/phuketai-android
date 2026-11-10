/* Smoke test: run the bundled web app inside jsdom against the real API. */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const WWW = path.resolve('app/assets/www');
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')
  .replace(/<script[^>]*><\/script>/g, '');

const dom = new JSDOM(html, { url: 'http://localhost/#/home', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
window.fetch = fetch;
window.TextDecoder = TextDecoder;
window.AbortController = AbortController;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};

const files = ['util.js', 'api.js', 'pages-core.js', 'pages-user.js', 'pages-auth.js', 'chat.js', 'main.js'];
const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
const origError = console.error;
console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); };

for (const f of files) {
  try {
    window.eval(fs.readFileSync(path.join(WWW, 'js', f), 'utf8'));
  } catch (e) {
    errors.push('eval ' + f + ': ' + e.message);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await sleep(6000);

function text(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '[null]'; }
if (errors.length) { console.log('EARLY ERRORS'); errors.forEach(e => console.log(' - ' + e)); }

const results = [];
const view = window.document.querySelector('#view');
results.push(['boot view', view ? text(view).slice(0, 120) : 'NO VIEW']);
results.push(['tabs', window.document.querySelectorAll('.tab').length]);
results.push(['appbar title', text(window.document.querySelector('.appbar-title'))]);

// plaza
window.location.hash = '#/plaza';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(800);
const plazaText = text(window.document.querySelector('#view'));
results.push(['plaza rows', window.document.querySelectorAll('#view .model-row').length]);
results.push(['plaza text', plazaText.slice(0, 120)]);

// model detail sheet
const firstRow = window.document.querySelector('#view .model-row');
if (firstRow) {
  firstRow.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(300);
  results.push(['model sheet', text(window.document.querySelector('.sheet') || document.body).slice(0, 90)]);
  window.U.closeOverlay();
}

// login page
window.location.hash = '#/login';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(400);
results.push(['login fields', window.document.querySelectorAll('#view input').length]);
results.push(['login text', text(window.document.querySelector('#view')).slice(0, 90)]);

// register page
window.location.hash = '#/register';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(400);
results.push(['register fields', window.document.querySelectorAll('#view input').length]);

// keys page (logged out -> prompt)
window.location.hash = '#/keys';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(400);
results.push(['keys logged-out', text(window.document.querySelector('#view')).slice(0, 60)]);

// announcements
window.location.hash = '#/announcements';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(800);
results.push(['announcements', text(window.document.querySelector('#view')).slice(0, 60)]);

// about
window.location.hash = '#/about';
window.dispatchEvent(new window.Event('hashchange'));
await sleep(400);
results.push(['about', text(window.document.querySelector('#view')).slice(0, 60)]);

// public api checks
const settings = await window.Api.settings();
const plaza = await window.Api.plaza();
const models = window.PagesCore.plazaModels(plaza);
const first = models[0];
results.push(['settings site_name', settings.site_name]);
results.push(['groups', plaza.groups.length, 'models', models.length]);
results.push(['model sample', first.name + ' | 入 ' + first.input.toFixed(3) + ' 出 ' + first.output.toFixed(3)]);

for (const r of results) console.log(r.map(x => typeof x === 'number' ? x : String(x)).join(' | '));
console.log('\nERRORS (' + errors.length + ')');
errors.slice(0, 20).forEach(e => console.log(' - ' + e));
