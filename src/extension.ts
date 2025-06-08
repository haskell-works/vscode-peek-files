// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const decorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline',
  });

  const fileRegex = /\b[\w\-./\\]+\.(json|md|txt|yaml|yml)\b/g;

  async function updateDecorations(editor: vscode.TextEditor) {
    if (!editor) {
      return;
    }

    const text = editor.document.getText();
    const candidates: { match: string; range: vscode.Range }[] = [];

    let match;
    while ((match = fileRegex.exec(text)) !== null) {
      const filename = match[0];
      const startPos = editor.document.positionAt(match.index);
      const endPos = editor.document.positionAt(match.index + filename.length);
      candidates.push({ match: filename, range: new vscode.Range(startPos, endPos) });
    }

    // Build a set of all unique basenames (e.g. "main.rs", "foo.txt")
    const uniqueFilenames = [...new Set(candidates.map(c => path.basename(c.match)))];

    // Search workspace for all files with matching basenames
    const foundFiles = await Promise.all(
      uniqueFilenames.map(name =>
        vscode.workspace.findFiles(`**/${name}`, '**/node_modules/**', 10)
      )
    );

    const foundFileSet = new Set(
      foundFiles.flat().map(uri => path.basename(uri.fsPath))
    );

    // Only decorate if basename exists somewhere in the workspace
    const decorations = candidates
      .filter(({ match }) => foundFileSet.has(path.basename(match)))
      .map(({ range }) => ({ range }));

    editor.setDecorations(decorationType, decorations);
  }

  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      updateDecorations(editor);
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) {
      updateDecorations(editor);
    }
  }, null, context.subscriptions);

  if (vscode.window.activeTextEditor) {
    updateDecorations(vscode.window.activeTextEditor);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
