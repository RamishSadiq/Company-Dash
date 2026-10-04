import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCodexPath } from '../server/codex-path.mjs';

test('missing desktop CLI recovers within its managed bin root without replacing working or unrelated paths', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'command-center-codex-'));
  try {
    const bin = path.join(temporary, 'OpenAI', 'Codex', 'bin');
    const configured = path.join(bin, '00000000', 'codex.exe');
    assert.equal(resolveCodexPath(configured), configured);
    const older = path.join(bin, '11111111', 'codex.exe');
    const newer = path.join(bin, '22222222', 'codex.exe');
    for (const candidate of [older, newer]) {
      fs.mkdirSync(path.dirname(candidate), { recursive: true });
      fs.writeFileSync(candidate, 'test fixture, not an executable');
    }
    fs.utimesSync(older, 100, 100);
    fs.utimesSync(newer, 200, 200);
    assert.equal(resolveCodexPath(configured), newer);
    assert.equal(resolveCodexPath(older), older);
    const unrelated = path.join(temporary, 'other-cli', 'codex.exe');
    assert.equal(resolveCodexPath(unrelated), unrelated);
    assert.equal(resolveCodexPath('codex'), 'codex');
  } finally {
    const target = fs.realpathSync(temporary);
    assert.equal(path.dirname(target), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('command-center-codex-'));
    fs.rmSync(target, { recursive: true, force: true });
  }
});
