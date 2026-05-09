import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  BasenameIndex,
  buildPattern,
  chunkBasenames,
  computeGaps,
  detectArgvBudget,
  findFilesByBasenames,
  isSafeBasename,
  mergeRanges,
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

suite('BasenameIndex (pure ops)', () => {
  let idx: BasenameIndex;

  setup(async () => {
    // Use an extension that won't match anything in the workspace so seed is
    // empty quickly. Clear after ready resolves to drop any race-window writes.
    idx = new BasenameIndex(['__peek_never_match_zzzzz__']);
    await idx.ready;
    idx.clear();
  });

  teardown(() => {
    idx.dispose();
  });

  test('add then has and get', () => {
    const u = vscode.Uri.file('/tmp/peek-files-tests/a/foo.json');
    idx.add(u);
    assert.strictEqual(idx.has('foo.json'), true);
    const got = idx.get('foo.json').map(x => x.fsPath);
    assert.deepStrictEqual(got, ['/tmp/peek-files-tests/a/foo.json']);
    assert.strictEqual(idx.size(), 1);
  });

  test('two URIs sharing a basename are deduped by fsPath', () => {
    const a = vscode.Uri.file('/tmp/peek-files-tests/a/foo.json');
    const b = vscode.Uri.file('/tmp/peek-files-tests/b/foo.json');
    idx.add(a);
    idx.add(b);
    idx.add(a); // duplicate add is a no-op
    const paths = idx.get('foo.json').map(x => x.fsPath).sort();
    assert.deepStrictEqual(paths, [
      '/tmp/peek-files-tests/a/foo.json',
      '/tmp/peek-files-tests/b/foo.json',
    ]);
    assert.strictEqual(idx.size(), 2);
  });

  test('remove drops the basename entry when the last URI is removed', () => {
    const u = vscode.Uri.file('/tmp/peek-files-tests/a/only.json');
    idx.add(u);
    idx.remove(u);
    assert.strictEqual(idx.has('only.json'), false);
    assert.deepStrictEqual(idx.get('only.json'), []);
    assert.strictEqual(idx.size(), 0);
  });

  test('remove of unknown URI is a no-op', () => {
    idx.add(vscode.Uri.file('/tmp/peek-files-tests/a/foo.json'));
    idx.remove(vscode.Uri.file('/tmp/peek-files-tests/never-added.json'));
    assert.strictEqual(idx.has('foo.json'), true);
    assert.strictEqual(idx.size(), 1);
  });

  test('removeUnderPrefix removes only entries under the prefix', () => {
    const inside1 = vscode.Uri.file('/tmp/peek-files-tests/docs/a.md');
    const inside2 = vscode.Uri.file('/tmp/peek-files-tests/docs/sub/b.md');
    const sibling = vscode.Uri.file('/tmp/peek-files-tests/other/c.md');
    idx.add(inside1);
    idx.add(inside2);
    idx.add(sibling);

    idx.removeUnderPrefix('/tmp/peek-files-tests/docs' + path.sep);

    assert.strictEqual(idx.has('a.md'), false);
    assert.strictEqual(idx.has('b.md'), false);
    assert.strictEqual(idx.has('c.md'), true);
    assert.strictEqual(idx.size(), 1);
  });

  test('clear empties the index', () => {
    idx.add(vscode.Uri.file('/tmp/peek-files-tests/a/foo.json'));
    idx.add(vscode.Uri.file('/tmp/peek-files-tests/b/bar.md'));
    idx.clear();
    assert.strictEqual(idx.size(), 0);
    assert.strictEqual(idx.has('foo.json'), false);
    assert.strictEqual(idx.has('bar.md'), false);
  });
});

suite('BasenameIndex (integration)', function () {
  this.timeout(15000);

  let workspaceRoot: vscode.Uri;
  let idx: BasenameIndex;
  let scratch: vscode.Uri;

  suiteSetup(function () {
    if (!vscode.workspace.workspaceFolders?.length) {
      this.skip();
    }
    workspaceRoot = vscode.workspace.workspaceFolders![0].uri;
  });

  setup(async () => {
    scratch = vscode.Uri.joinPath(workspaceRoot, '__peek_idx_scratch__');
    try { await vscode.workspace.fs.delete(scratch, { recursive: true, useTrash: false }); } catch { /* not present */ }
    await vscode.workspace.fs.createDirectory(scratch);
    idx = new BasenameIndex(['json', 'md', 'txt', 'yaml', 'yml']);
    await idx.ready;
  });

  teardown(async () => {
    idx.dispose();
    try { await vscode.workspace.fs.delete(scratch, { recursive: true, useTrash: false }); } catch { /* gone */ }
  });

  async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitFor timed out after ${timeoutMs}ms`);
      }
      await new Promise(r => setTimeout(r, 50));
    }
  }

  test('seed picks up existing workspace files', () => {
    assert.strictEqual(idx.has('package.json'), true, 'package.json should be in the seeded index');
    assert.strictEqual(idx.has('tsconfig.json'), true, 'tsconfig.json should be in the seeded index');
  });

  test('watcher adds on create and removes on delete', async () => {
    const name = `peek-idx-${Date.now()}.json`;
    const uri = vscode.Uri.joinPath(scratch, name);

    await vscode.workspace.fs.writeFile(uri, Buffer.from('{}'));
    await waitFor(() => idx.has(name));

    await vscode.workspace.fs.delete(uri, { useTrash: false });
    await waitFor(() => !idx.has(name));
  });

  test('folder delete evicts every contained basename via prefix prune', async () => {
    const dirName = `peek-idx-dir-${Date.now()}`;
    const dir = vscode.Uri.joinPath(scratch, dirName);
    await vscode.workspace.fs.createDirectory(dir);
    const a = `peek-idx-a-${Date.now()}.md`;
    const b = `peek-idx-b-${Date.now()}.md`;
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, a), Buffer.from('a'));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, b), Buffer.from('b'));
    await waitFor(() => idx.has(a) && idx.has(b));

    await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
    await waitFor(() => !idx.has(a) && !idx.has(b));
  });
});

suite('mergeRanges', () => {
  test('empty input returns []', () => {
    assert.deepStrictEqual(mergeRanges([]), []);
  });

  test('single range passes through', () => {
    assert.deepStrictEqual(mergeRanges([{ start: 5, end: 10 }]), [{ start: 5, end: 10 }]);
  });

  test('disjoint sorted ranges are preserved', () => {
    assert.deepStrictEqual(
      mergeRanges([{ start: 0, end: 5 }, { start: 10, end: 15 }]),
      [{ start: 0, end: 5 }, { start: 10, end: 15 }],
    );
  });

  test('adjacent ranges (end+1 == next.start) are merged', () => {
    assert.deepStrictEqual(
      mergeRanges([{ start: 0, end: 5 }, { start: 6, end: 10 }]),
      [{ start: 0, end: 10 }],
    );
  });

  test('overlapping ranges are merged', () => {
    assert.deepStrictEqual(
      mergeRanges([{ start: 0, end: 7 }, { start: 5, end: 12 }]),
      [{ start: 0, end: 12 }],
    );
  });

  test('out-of-order input is sorted before merging', () => {
    assert.deepStrictEqual(
      mergeRanges([{ start: 20, end: 30 }, { start: 0, end: 5 }, { start: 10, end: 15 }]),
      [{ start: 0, end: 5 }, { start: 10, end: 15 }, { start: 20, end: 30 }],
    );
  });

  test('nested ranges (one contains the other) collapse to the outer', () => {
    assert.deepStrictEqual(
      mergeRanges([{ start: 0, end: 100 }, { start: 20, end: 30 }]),
      [{ start: 0, end: 100 }],
    );
  });

  test('does not mutate the input', () => {
    const input = [{ start: 10, end: 20 }, { start: 0, end: 5 }];
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeRanges(input);
    assert.deepStrictEqual(input, snapshot);
  });
});

suite('computeGaps', () => {
  test('empty wanted returns []', () => {
    assert.deepStrictEqual(computeGaps([{ start: 0, end: 100 }], []), []);
  });

  test('empty scanned returns the merged wanted set', () => {
    assert.deepStrictEqual(
      computeGaps([], [{ start: 0, end: 50 }, { start: 60, end: 100 }]),
      [{ start: 0, end: 50 }, { start: 60, end: 100 }],
    );
  });

  test('wanted fully covered by scanned returns []', () => {
    assert.deepStrictEqual(
      computeGaps([{ start: 0, end: 100 }], [{ start: 20, end: 80 }]),
      [],
    );
  });

  test('wanted entirely disjoint from scanned returns wanted', () => {
    assert.deepStrictEqual(
      computeGaps([{ start: 0, end: 100 }], [{ start: 200, end: 300 }]),
      [{ start: 200, end: 300 }],
    );
  });

  test('partial left overlap leaves the uncovered tail', () => {
    assert.deepStrictEqual(
      computeGaps([{ start: 0, end: 50 }], [{ start: 30, end: 100 }]),
      [{ start: 51, end: 100 }],
    );
  });

  test('partial right overlap leaves the uncovered head', () => {
    assert.deepStrictEqual(
      computeGaps([{ start: 60, end: 200 }], [{ start: 0, end: 100 }]),
      [{ start: 0, end: 59 }],
    );
  });

  test('a hole in the middle of scanned produces two gaps', () => {
    assert.deepStrictEqual(
      computeGaps(
        [{ start: 0, end: 50 }, { start: 100, end: 150 }],
        [{ start: 20, end: 130 }],
      ),
      [{ start: 51, end: 99 }],
    );
  });

  test('scanned interior of wanted produces gaps on both sides', () => {
    assert.deepStrictEqual(
      computeGaps([{ start: 30, end: 60 }], [{ start: 0, end: 100 }]),
      [{ start: 0, end: 29 }, { start: 61, end: 100 }],
    );
  });

  test('multiple wanted ranges each get gap-clipped independently', () => {
    assert.deepStrictEqual(
      computeGaps(
        [{ start: 50, end: 150 }],
        [{ start: 0, end: 100 }, { start: 120, end: 200 }],
      ),
      [{ start: 0, end: 49 }, { start: 151, end: 200 }],
    );
  });

  test('adjacent (end+1 == start) scanned range covers wanted with no gap', () => {
    assert.deepStrictEqual(
      computeGaps(
        [{ start: 0, end: 49 }, { start: 50, end: 100 }],
        [{ start: 0, end: 100 }],
      ),
      [],
    );
  });
});

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});
