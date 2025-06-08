// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const decorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline',
  });


  async function updateDecorations(editor: vscode.TextEditor) {
    if (!editor) {
      return;
    }

    const text = editor.document.getText();
    const fileRegex = /\b[\w\-.\/]+\.(txt|js|ts|rs|java|cpp|c|md|json|yaml|yml|py|go|rb|sh)\b/g;
    const decorations: vscode.DecorationOptions[] = [];

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      return;
    }

    const basePath = workspaceFolder.uri.fsPath;
    const candidates: { match: string; range: vscode.Range }[] = [];

    let match;
    while ((match = fileRegex.exec(text)) !== null) {
      const filename = match[0];
      const startPos = editor.document.positionAt(match.index);
      const endPos = editor.document.positionAt(match.index + filename.length);
      const range = new vscode.Range(startPos, endPos);
      candidates.push({ match: filename, range });
    }

    await Promise.all(
      candidates.map(async ({ match, range }) => {
        const fileUri = vscode.Uri.file(require('path').resolve(basePath, match));
        try {
          await vscode.workspace.fs.stat(fileUri);
          decorations.push({ range });
        } catch {
          // File does not exist, skip
        }
      })
    );

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
