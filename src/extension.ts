// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { execFileSync } from 'child_process';

const config = vscode.workspace.getConfiguration('peekFiles');
const parentTraversalCost = config.get<number>('parentTraversalCost', 1000);
const filenameRegex = /\b[\w\-./\\]+\.\w+\b/;

const decorationType = vscode.window.createTextEditorDecorationType({
  textDecoration: 'underline',
});

const fileExtensions = config.get<string[]>('fileExtensions', ['json', 'md', 'txt', 'yaml', 'yml']);
const extPattern = fileExtensions.join('|');
const fileRegex = new RegExp(`\\b[\\w\\-./\\\\]+\\.(${extPattern})\\b`, 'g');

const DEBOUNCE_MS = 200;
const MAX_NAMES_PER_CHUNK = 5000;
const FALLBACK_ARGV_BUDGET = 16 * 1024;

let argvBudget = FALLBACK_ARGV_BUDGET;

type ScanState = {
  timer?: NodeJS.Timeout;
  tokenSource?: vscode.CancellationTokenSource;
};
const scanStates = new Map<string, ScanState>();

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  argvBudget = detectArgvBudget();

  context.subscriptions.push(
    vscode.commands.registerCommand('extension.peekFile', peekFileCommand)
  );

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider({ scheme: 'file' }, { provideDefinition })
  );

  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      scheduleDecorations(editor, 0);
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) {
      scheduleDecorations(editor, DEBOUNCE_MS);
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidCloseTextDocument(doc => {
    cancelScan(doc.uri.toString());
  }, null, context.subscriptions);

  if (vscode.window.activeTextEditor) {
    scheduleDecorations(vscode.window.activeTextEditor, 0);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  for (const key of [...scanStates.keys()]) {
    cancelScan(key);
  }
}

function scheduleDecorations(editor: vscode.TextEditor, delayMs: number) {
  const key = editor.document.uri.toString();
  let state = scanStates.get(key);
  if (!state) {
    state = {};
    scanStates.set(key, state);
  }
  const s = state;
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = undefined;
  }
  if (s.tokenSource) {
    s.tokenSource.cancel();
    s.tokenSource.dispose();
    s.tokenSource = undefined;
  }
  s.timer = setTimeout(() => {
    s.timer = undefined;
    const tokenSource = new vscode.CancellationTokenSource();
    s.tokenSource = tokenSource;
    void updateDecorations(editor, tokenSource.token).finally(() => {
      if (s.tokenSource === tokenSource) {
        tokenSource.dispose();
        s.tokenSource = undefined;
      }
    });
  }, delayMs);
}

function cancelScan(key: string) {
  const state = scanStates.get(key);
  if (!state) {return;}
  if (state.timer) {clearTimeout(state.timer);}
  if (state.tokenSource) {
    state.tokenSource.cancel();
    state.tokenSource.dispose();
  }
  scanStates.delete(key);
}

async function updateDecorations(editor: vscode.TextEditor, token: vscode.CancellationToken) {
  const text = editor.document.getText();
  const candidates: { match: string; range: vscode.Range }[] = [];

  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    const filename = match[0];
    const startPos = editor.document.positionAt(match.index);
    const endPos = editor.document.positionAt(match.index + filename.length);
    candidates.push({ match: filename, range: new vscode.Range(startPos, endPos) });
  }

  const uniqueFilenames = [...new Set(candidates.map(c => path.basename(c.match)))];

  if (uniqueFilenames.length === 0) {
    if (!token.isCancellationRequested) {
      editor.setDecorations(decorationType, []);
    }
    return;
  }

  const foundUris = await findFilesByBasenames(uniqueFilenames, undefined, token);
  if (token.isCancellationRequested) {return;}

  const foundFileSet = new Set(foundUris.map(uri => path.basename(uri.fsPath)));

  const decorations = candidates
    .filter(({ match }) => foundFileSet.has(path.basename(match)))
    .map(({ range }) => ({ range }));

  editor.setDecorations(decorationType, decorations);
}

// Searches the workspace for files matching any of `basenames`. Collapses many
// basenames into one or a few brace-glob `findFiles` calls, chunked so the
// resulting glob fits inside the OS argv budget detected at activation.
//
// `perCallMax` overrides the per-`findFiles` result cap; when omitted, each
// call asks for at most `chunk.length` results — enough to prove existence
// without dragging tens of thousands of URIs through IPC.
export async function findFilesByBasenames(
  basenames: string[],
  perCallMax?: number,
  token?: vscode.CancellationToken
): Promise<vscode.Uri[]> {
  if (basenames.length === 0) {return [];}
  // Drop any basename containing glob metacharacters: VS Code's findFiles
  // parser silently returns no results for an entire brace pattern if even
  // one alternative contains backslash escapes, so escaping at this layer is
  // actively harmful. fileRegex already prevents these chars from real input.
  const safe = basenames.filter(isSafeBasename);
  if (safe.length === 0) {return [];}
  const chunks = chunkBasenames(safe, argvBudget, MAX_NAMES_PER_CHUNK);
  const results = await Promise.all(
    chunks.map(chunk => {
      const max = perCallMax ?? chunk.length;
      return vscode.workspace.findFiles(buildPattern(chunk), '**/node_modules/**', max, token);
    })
  );
  return results.flat();
}

const UNSAFE_GLOB_CHARS = /[\\{},*?[\]]/;

export function isSafeBasename(name: string): boolean {
  return name.length > 0 && !UNSAFE_GLOB_CHARS.test(name);
}

export function buildPattern(chunk: string[]): string {
  if (chunk.length === 1) {return `**/${chunk[0]}`;}
  return `**/{${chunk.join(',')}}`;
}

// Greedy pack of `escapedNames` into chunks whose joined `**/{...}` pattern
// stays under `budgetBytes`. A single oversized name still gets its own chunk
// (better to try and let ripgrep complain than to drop it).
export function chunkBasenames(
  escapedNames: string[],
  budgetBytes: number,
  maxNames: number = MAX_NAMES_PER_CHUNK
): string[][] {
  const chunks: string[][] = [];
  if (escapedNames.length === 0) {return chunks;}
  const overhead = 5; // "**/{}"
  let chunk: string[] = [];
  let bytes = overhead;
  for (const name of escapedNames) {
    const nameBytes = Buffer.byteLength(name);
    const sepBytes = chunk.length === 0 ? 0 : 1;
    if (chunk.length > 0 && (bytes + sepBytes + nameBytes > budgetBytes || chunk.length >= maxNames)) {
      chunks.push(chunk);
      chunk = [];
      bytes = overhead;
    }
    const newSep = chunk.length === 0 ? 0 : 1;
    chunk.push(name);
    bytes += newSep + nameBytes;
  }
  if (chunk.length > 0) {chunks.push(chunk);}
  return chunks;
}

// Probes the kernel's argv+envp limit so we know how big a single brace-glob
// can be before `execve` rejects it. macOS halves the budget because VS Code's
// ripgrep search adds a second NFD-normalized copy of the pattern.
export function detectArgvBudget(): number {
  if (process.platform === 'win32') {return FALLBACK_ARGV_BUDGET;}
  try {
    const out = execFileSync('getconf', ['ARG_MAX'], { timeout: 500, encoding: 'utf8' });
    const argMax = parseInt(out.trim(), 10);
    if (!Number.isFinite(argMax) || argMax <= 0) {throw new Error('bad ARG_MAX');}
    const envBytes = Object.entries(process.env)
      .reduce((s, [k, v]) => s + k.length + (v?.length ?? 0) + 2, 0);
    const overhead = envBytes + 4096;
    const divisor = process.platform === 'darwin' ? 2 : 1;
    return Math.max(8 * 1024, Math.floor((argMax - overhead) * 0.75 / divisor));
  } catch {
    return FALLBACK_ARGV_BUDGET;
  }
}

async function peekFileCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const position = editor.selection.active;
  const wordRange = editor.document.getWordRangeAtPosition(position, filenameRegex);
  if (!wordRange) {
    return;
  }

  const word = editor.document.getText(wordRange);
  const basename = path.basename(word);

  const bestMatch = await findClosestFile(basename, path.dirname(editor.document.uri.fsPath));
  if (!bestMatch) {
    vscode.window.showInformationMessage(`Could not resolve closest file for "${basename}".`);
    return;
  }

  const location = new vscode.Location(bestMatch, new vscode.Position(0, 0));
  await vscode.commands.executeCommand(
    'editor.action.peekLocations',
    editor.document.uri,
    position,
    [location],
    'peek'
  );
}

async function findClosestFile(
  basename: string,
  relativeTo: string
): Promise<vscode.Uri | undefined> {
  const matches = await findFilesByBasenames([basename], 50);
  if (matches.length === 0) {
    return;
  }

  const currentParts = relativeTo.split(path.sep).filter(Boolean);
  let bestMatch: vscode.Uri | null = null;
  let minDistance = Infinity;

  for (const uri of matches) {
    const matchParts = path.dirname(uri.fsPath).split(path.sep).filter(Boolean);
    const distance = pathDistance(currentParts, matchParts);
    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = uri;
    }
  }

  return bestMatch ?? undefined;
}

function pathDistance(fromParts: string[], toParts: string[]): number {
  const len = Math.min(fromParts.length, toParts.length);
  let common = 0;

  for (; common < len; ++common) {
    if (fromParts[common] !== toParts[common]) {
      break;
    }
  }

  const up = fromParts.length - common;
  const down = toParts.length - common;

  return up * parentTraversalCost + down;
}

async function provideDefinition(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.Location | undefined> {
  const wordRange = document.getWordRangeAtPosition(position, filenameRegex);
  if (!wordRange) {
    return;
  }

  const word = document.getText(wordRange);
  const basename = path.basename(word);

  const bestMatch = await findClosestFile(basename, path.dirname(document.uri.fsPath));
  if (!bestMatch) {
    vscode.window.setStatusBarMessage(`No file found matching "${basename}"`, 2000);
    return;
  }

  return new vscode.Location(bestMatch, new vscode.Position(0, 0));
}
