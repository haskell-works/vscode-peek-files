// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const decorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline',
  });

  const updateDecorations = (editor: vscode.TextEditor) => {
    if (!editor) {
      return;
    }

    const text = editor.document.getText();
    const fileRegex = /\b[\w\-.\/]+\.(txt|js|ts|rs|java|cpp|c|md|json|yaml|yml|py|go|rb|sh)\b/g;
    const decorations: vscode.DecorationOptions[] = [];

    let match;
    while ((match = fileRegex.exec(text)) !== null) {
      const startPos = editor.document.positionAt(match.index);
      const endPos = editor.document.positionAt(match.index + match[0].length);
      decorations.push({ range: new vscode.Range(startPos, endPos) });
    }

    editor.setDecorations(decorationType, decorations);
  };

  // Run when an editor becomes active
  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      updateDecorations(editor);
    }
  }, null, context.subscriptions);

  // Run on text change
  vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) {
      updateDecorations(editor);
    }
  }, null, context.subscriptions);

  // Run initially for active editor
  if (vscode.window.activeTextEditor) {
    updateDecorations(vscode.window.activeTextEditor);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
