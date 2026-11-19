# Contributing

Bug reports and suggestions are welcome as
[GitHub issues](https://github.com/thejaz/planner/issues). For a bug, include your
Obsidian version, the plugin version, and a small example note that shows the
problem. Use made-up data, never your real notes.

## Development

Planner needs Node 24.

```sh
npm ci
npm run setup:lint
npm run check
```

`npm run check` runs the Obsidian lint rules, the type check, the tests, and the
build. `npm run dev` rebuilds on change. See [docs/maintaining.md](docs/maintaining.md)
for the structure of the code and [docs/debug-checks.md](docs/debug-checks.md) for
the checks inside a running Obsidian.

## Ground rules

- Markdown stays authoritative: notes must remain readable and editable without
  the plugin, and the plugin never adds its own metadata or markup to them.
- The calculation core in `src/core` does not depend on Obsidian.
- Tests and fixtures use synthetic notes only.
- Changes to interaction or storage need a check in an isolated test vault, not
  only unit tests.

## Pull requests

Keep each pull request to one fix or feature, add or update tests for it, and make
sure `npm run check` passes. Describe what you verified and what you could not.
