import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['main.js', 'node_modules/**', 'dist/**', 'demo/**', 'images/**', 'scripts/**', 'tests/**', 'eslint.config.mjs'] },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      // Product, core-plugin, command and key names keep their canonical casing.
      'obsidianmd/ui/sentence-case': ['warn', {
        brands: ['Obsidian', 'Top of the Desk', 'Base', 'Files', 'Web viewer', 'New note stack', 'Desk/Scratchpad.md'],
        ignoreWords: ['Left', 'Right', 'Home', 'End'],
      }],
    },
  },
]);
