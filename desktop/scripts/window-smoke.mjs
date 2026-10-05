import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const fixture = fileURLToPath(new URL('fixtures/window-smoke.mjs', import.meta.url));
const userData = await mkdtemp(join(tmpdir(), 'asphodel-window-smoke-'));
const rootFlags = process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [];
let electron;
const errors = [];
async function launch() {
  electron = await _electron.launch({ args: [...rootFlags, fixture], env: { ...process.env, ASPHODEL_TEST_USER_DATA: userData }, timeout: 20_000 });
  const page = await electron.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.asphodelDesktop && document.querySelector('#backend-status')?.textContent === 'Prêt');
  assert.equal(await electron.evaluate(({ Menu }) => Menu.getApplicationMenu()), null);
  await page.keyboard.press('Alt');
  assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  return page;
}
async function assertFullscreen(page, expected) {
  await page.waitForFunction(async expected => (await window.asphodelDesktop.getDisplayState()).fullscreen === expected, expected);
}
try {
  let page = await launch();
  await assertFullscreen(page, true);
  await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
  await page.getByLabel('Mode d’affichage', { exact: true }).selectOption('window');
  await assertFullscreen(page, false);
  assert.equal(JSON.parse(await readFile(join(userData, 'display-preferences.json'), 'utf8')).fullscreen, false);
  // Text editing remains available after removing the native Edit menu.
  await page.keyboard.press('Escape');
  const query = page.getByLabel('Search card name or Oracle text');
  await query.fill('Sol Ring');
  await query.press('ControlOrMeta+A');
  await query.press('Backspace');
  assert.equal(await query.inputValue(), '');
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 640));
  await page.waitForFunction(() => innerWidth === 960);
  assert.equal(await page.evaluate(() => {
    const header = document.querySelector('.app-header');
    return header.scrollWidth <= header.clientWidth;
  }), true, 'Header controls must fit the minimum window width');
  await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
  await page.getByRole('button', { name: 'Terminé', exact: true }).click();
  await electron.close(); electron = undefined;
  page = await launch();
  await assertFullscreen(page, false);
  await page.keyboard.press('F11');
  await assertFullscreen(page, true);
  await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
  await page.getByLabel('Mode d’affichage', { exact: true }).selectOption('window');
  await assertFullscreen(page, false);
  await page.keyboard.press('F11');
  await assertFullscreen(page, true);
  await page.waitForFunction(() => document.querySelector('#desktop-display-mode')?.value === 'fullscreen');
  await page.keyboard.press('Escape');
  await electron.close(); electron = undefined;
  page = await launch();
  await assertFullscreen(page, true);
  // Even an extra Electron window with our preload cannot invoke app controls.
  assert.match(await electron.evaluate(async ({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows()[0];
    const other = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, preload: main.webContents.getLastWebPreferences().preload } });
    try {
      await other.loadURL('data:text/html,<title>Untrusted window</title>');
      return await other.webContents.executeJavaScript('window.asphodelDesktop.getDisplayState().then(() => "unexpected success", error => error.message)');
    } finally { other.destroy(); }
  }), /refused/);
  await page.screenshot({ path: process.env.ASPHODEL_WINDOW_SCREENSHOT ?? join(userData, 'window.png') });
  const electronProcess = electron.process();
  let exitTimer;
  const exited = new Promise((resolve, reject) => {
    electronProcess.once('exit', (code, signal) => resolve({ code, signal }));
    exitTimer = setTimeout(() => reject(new Error('Quitter did not close Electron within 20 seconds')), 20_000);
  });
  try {
    const [, result] = await Promise.all([page.getByRole('button', { name: 'Quitter', exact: true }).click(), exited]);
    assert.deepEqual(result, { code: 0, signal: null });
  } finally { clearTimeout(exitTimer); }
  electron = undefined;
  assert.deepEqual(errors, []);
  console.log('Window smoke passed: fullscreen default, menu hidden after Alt, settings/F11, restart persistence, text editing, IPC isolation and in-app quit.');
} finally {
  if (electron) await electron.close();
  await rm(userData, { recursive: true, force: true });
}
