# Peek Files

**Peek into matching files under your cursor. Automatically underline filenames in the editor when they exist in your workspace.**

[![Visual Studio Marketplace](https://vsmarketplacebadge.apphb.com/version-short/JohnKy.peek-files.png)](https://marketplace.visualstudio.com/items?itemName=JohnKy.peek-files)
[![Installs](https://vsmarketplacebadge.apphb.com/installs/JohnKy.peek-files.png)](https://marketplace.visualstudio.com/items?itemName=JohnKy.peek-files)

---

## ✨ Features

- Underlines filenames like `config.json`, `README.md`, `notes.txt` only if they exist in your project.
- Peek the **closest matching file** using:
  - `Cmd+Alt+P` (macOS) / `Ctrl+Alt+P` (Windows/Linux)
  - Or by `Alt+Cmd+Click` (like a definition peek)
- Smart file resolution:
  - Chooses the closest file path based on folder depth
  - Penalizes upward traversal using a configurable `parentTraversalCost`

---

## 🖱️ How It Works

If your code or text contains a string like:

```text
../data/schema.json
```

And a file named `schema.json` exists anywhere in your workspace, the word will be underlined. You can then:

- Press `Cmd+Alt+P` or `Alt+Cmd+Click` to **peek** that file.

---

## ⚙️ Settings

You can customize behavior via VS Code settings:

| Setting                        | Type    | Default                     | Description                                                                 |
|-------------------------------|---------|-----------------------------|-----------------------------------------------------------------------------|
| `peekFiles.parentTraversalCost` | number  | `1000`                      | Cost of going up a directory when ranking file matches                     |
| `peekFiles.fileExtensions`    | string[] | `["json", "md", "txt", "yaml", "yml"]` | List of file extensions to underline and peek                              |

Example `settings.json`:
```json
{
  "peekFiles.parentTraversalCost": 500,
  "peekFiles.fileExtensions": ["json", "ts", "tsx", "md"]
}
```

---

## 🧠 Why?

VS Code already lets you peek symbols and definitions, but it doesn’t support peeking random filenames — especially when written as plain text or code comments. This extension helps bridge that gap.

---

## 🧪 Known Limitations

- Only matches by **basename** (not relative paths)
- Ignores `node_modules/**` for performance
- Currently only peeks to the **first line** of the file

---

## 🛠️ Contributing

1. Clone this repo
2. Run `npm install`
3. Run the extension in the VS Code Extension Development Host
4. PRs welcome!

---

## 📦 Publishing

To build and publish:

```bash
vsce package
vsce publish
```

---

## 📄 License

MIT © [John Ky](https://github.com/JohnKy)
