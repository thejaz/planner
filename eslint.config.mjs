import { createRequire } from 'node:module';

// TypeScript 7 builds the plugin. The official checker uses the TypeScript 5
// compiler API, so its development-only dependencies have a separate lockfile.
const require = createRequire(new URL('./tools/lint/package.json', import.meta.url));
const obsidianmd = require('eslint-plugin-obsidianmd').default;

export default [
  { ignores: ['node_modules/**', 'dist/**', 'artifacts/**', '.test-*/**', 'tests/**', 'tools/**'] },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // Authored lowercase actions, note syntax, key names and setting titles
      // retain their agreed spelling. Other interface copy is still checked.
      'obsidianmd/ui/sentence-case': ['warn', {
        ignoreWords: ['Planner', 'Activity', 'Report', 'Today', 'Undo', 'PLN', 'DTF', 'F2', 'Europe/Berlin'],
        ignoreRegex: [
          '^(?:rename or merge|open source|cancel|merge instead|preview|apply rename|random|save|remove|adopt summary emoji globally|restore assigned emoji|rename|📄 blank day)$',
          '^prj\\s+\\|', '^e\\.g\\. (?:DTF|PLN)$', '^Criteria & Markers note$',
          '^Row buttons show their single-key shortcuts\\.',
          '^Choose a short code, such as (?:pln|PLN)\\.', '^Counts keep the saved markers\\.', '^Used by Today and .*Europe/Berlin\\.$'
        ]
      }]
    }
  }
];
