import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DisplayPreferences, isTrustedDesktopFrame } from './display-preferences.mjs';

test('first launch is fullscreen; window and fullscreen choices survive independent launches', () => {
  const root = mkdtempSync(join(tmpdir(), 'asphodel-display-'));
  try {
    const path = join(root, 'user/display-preferences.json');
    const first = new DisplayPreferences(path);
    assert.equal(first.fullscreen, true);
    first.setFullscreen(false);
    const second = new DisplayPreferences(path);
    assert.equal(second.fullscreen, false);
    second.setFullscreen(true);
    assert.equal(new DisplayPreferences(path).fullscreen, true);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { version: 1, fullscreen: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid saved preferences recover to fullscreen and can be repaired', () => {
  const root = mkdtempSync(join(tmpdir(), 'asphodel-display-'));
  try {
    const path = join(root, 'display.json');
    for (const contents of ['broken JSON', '{"version":1,"fullscreen":"false"}', '{"version":2,"fullscreen":false}']) {
      writeFileSync(path, contents);
      const errors = [];
      const preferences = new DisplayPreferences(path, error => errors.push(error));
      assert.equal(preferences.fullscreen, true);
      assert.equal(errors.length, 1);
      preferences.setFullscreen(false);
      assert.equal(new DisplayPreferences(path).fullscreen, false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failed writes and invalid inputs do not change the remembered mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'asphodel-display-'));
  try {
    const parent = join(root, 'not-a-directory');
    writeFileSync(parent, 'block directory creation');
    const preferences = new DisplayPreferences(join(parent, 'display.json'), () => {});
    assert.throws(() => preferences.setFullscreen(false));
    assert.equal(preferences.fullscreen, true);
    assert.throws(() => preferences.setFullscreen('false'), TypeError);
    assert.equal(readFileSync(parent, 'utf8'), 'block directory creation');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('desktop commands accept only the current app main frame', () => {
  const contents = { mainFrame: { url: 'asphodel://app/' } };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(isTrustedDesktopFrame(event, contents), true);
  assert.equal(isTrustedDesktopFrame({ sender: {}, senderFrame: contents.mainFrame }, contents), false);
  assert.equal(isTrustedDesktopFrame({ sender: contents, senderFrame: { url: 'asphodel://app/' } }, contents), false);
  assert.equal(isTrustedDesktopFrame({ sender: contents, senderFrame: null }, contents), false);
  for (const url of ['file:///splash.html', 'https://app/', 'asphodel://app.evil/', 'asphodel://app:123/', 'data:text/html,test', 'invalid']) {
    contents.mainFrame.url = url;
    assert.equal(isTrustedDesktopFrame(event, contents), false);
  }
});
