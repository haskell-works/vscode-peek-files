import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: here,
});
