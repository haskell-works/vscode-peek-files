import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  buildPattern,
  chunkBasenames,
  detectArgvBudget,
  findFilesByBasenames,
  isSafeBasename,
} from '../extension';

suite('isSafeBasename', () => {
  test('accepts ordinary basenames', () => {
    assert.strictEqual(isSafeBasename('foo.json'), true);
    assert.strictEqual(isSafeBasename('My-File_1.yaml'), true);
    assert.strictEqual(isSafeBasename('a.b.c.txt'), true);
  });

  test('rejects basenames containing glob metacharacters', () => {
    for (const ch of ['{', '}', ',', '*', '?', '[', ']', '\\']) {
      assert.strictEqual(isSafeBasename(`a${ch}b.json`), false, `expected reject for ${JSON.stringify(ch)}`);
    }
  });

  test('rejects empty string', () => {
    assert.strictEqual(isSafeBasename(''), false);
  });
});

suite('buildPattern', () => {
  test('single name skips braces', () => {
    assert.strictEqual(buildPattern(['foo.json']), '**/foo.json');
  });

  test('multiple names use brace alternation', () => {
    assert.strictEqual(buildPattern(['a.json', 'b.md']), '**/{a.json,b.md}');
  });
});

suite('chunkBasenames', () => {
  test('empty input returns no chunks', () => {
    assert.deepStrictEqual(chunkBasenames([], 1024), []);
  });

  test('packs everything into one chunk when budget allows', () => {
    const names = ['a.json', 'b.md', 'c.txt'];
    assert.deepStrictEqual(chunkBasenames(names, 1024), [names]);
  });

  test('splits when adding the next name would exceed the budget', () => {
    // pattern overhead 5, each name 2 bytes, comma 1 byte
    // **/{aa,bb} = 10 bytes, **/{aa,bb,cc} = 13 bytes, budget 11 forces a split
    const chunks = chunkBasenames(['aa', 'bb', 'cc', 'dd'], 11);
    assert.deepStrictEqual(chunks, [['aa', 'bb'], ['cc', 'dd']]);
  });

  test('respects the maxNames cap independent of budget', () => {
    const names = Array.from({ length: 10 }, (_, i) => `f${i}`);
    const chunks = chunkBasenames(names, 1024 * 1024, 4);
    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0].length, 4);
    assert.strictEqual(chunks[1].length, 4);
    assert.strictEqual(chunks[2].length, 2);
  });

  test('a single oversized name still gets its own chunk', () => {
    const big = 'x'.repeat(100);
    const chunks = chunkBasenames([big, 'a'], 50);
    assert.strictEqual(chunks.length, 2);
    assert.deepStrictEqual(chunks[0], [big]);
    assert.deepStrictEqual(chunks[1], ['a']);
  });

  test('counts UTF-8 bytes rather than code units', () => {
    // 'é' is 2 bytes in UTF-8; pattern '**/{é,é}' = 5+2+1+2 = 10 bytes
    // budget 9 should force a split
    const chunks = chunkBasenames(['é', 'é'], 9);
    assert.strictEqual(chunks.length, 2);
  });
});

suite('detectArgvBudget', () => {
  test('returns a positive integer >= 8KB', () => {
    const budget = detectArgvBudget();
    assert.ok(Number.isFinite(budget), `expected finite, got ${budget}`);
    assert.ok(budget >= 8 * 1024, `expected >= 8KiB, got ${budget}`);
  });
});

suite('findFilesByBasenames (integration)', () => {
  suiteSetup(function () {
    if (!vscode.workspace.workspaceFolders?.length) {
      this.skip();
    }
  });

  test('empty input resolves to []', async () => {
    assert.deepStrictEqual(await findFilesByBasenames([]), []);
  });

  test('finds an existing file via the single-name fast path', async () => {
    const out = await findFilesByBasenames(['package.json']);
    const names = out.map(u => path.basename(u.fsPath));
    assert.ok(names.includes('package.json'), `expected package.json in ${names.join(',')}`);
  });

  test('multi-name brace pattern returns real hits and skips nonexistent', async () => {
    const out = await findFilesByBasenames(['package.json', 'tsconfig.json', 'definitely-not-here-zzz.txt']);
    const names = new Set(out.map(u => path.basename(u.fsPath)));
    assert.ok(names.has('package.json'));
    assert.ok(names.has('tsconfig.json'));
    assert.ok(!names.has('definitely-not-here-zzz.txt'));
  });

  test('200 basenames + 1 real hit still resolves the real hit', async () => {
    const fillers = Array.from({ length: 200 }, (_, i) => `peek-files-no-such-${i}.json`);
    const out = await findFilesByBasenames(['package.json', ...fillers]);
    const names = out.map(u => path.basename(u.fsPath));
    assert.ok(names.includes('package.json'), `expected package.json among ${names.length} results`);
  });

  test('unsafe basenames are dropped, leaving safe siblings findable', async () => {
    // If unsafe names weren't filtered, escaping them inside a brace pattern
    // poisons the whole search and even package.json wouldn't be found.
    const out = await findFilesByBasenames(['package.json', 'a{b,c}.json', 'x*y.json']);
    const names = out.map(u => path.basename(u.fsPath));
    assert.ok(names.includes('package.json'), `expected package.json in ${names.join(',')}`);
  });
});

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});
