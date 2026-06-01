# Repo Context Packer

Generate AI-ready context packs for any codebase in seconds.

Repo Context Packer scans a repository and creates a compact `.context-pack/`
folder that helps coding agents understand the project before making changes.

## Why

AI coding tools work better when they get crisp repository context: structure,
dependency hints, important files, and a reusable working prompt. This CLI turns
that context into Markdown files you can paste into a chat, attach to an agent,
or commit into a repository as onboarding material.

## Install

From GitHub:

```bash
npm install -g github:jiakai03177-coder/repo-context-packer
```

After npm publishing:

```bash
npm install -g repo-context-packer
```

For local development:

```bash
git clone https://github.com/jiakai03177-coder/repo-context-packer.git
cd repo-context-packer
npm link
```

## Usage

```bash
repo-context-packer
```

Custom root and output directory:

```bash
repo-context-packer --root ../my-app --out ./context-pack
```

Limit the number of summarized files:

```bash
repo-context-packer --max-files 120
```

## Output

```text
.context-pack/
  overview.md
  file-map.md
  dependencies.md
  agent-prompt.md
```

- `overview.md` summarizes repository shape, language mix, top-level paths, and notable code signals.
- `file-map.md` lists text/source files with sizes and extracted functions/classes/exports.
- `dependencies.md` summarizes common manifest files such as `package.json`, `pyproject.toml`, and `go.mod`.
- `agent-prompt.md` gives a ready-to-use starter prompt for AI coding agents.

## Development

```bash
npm test
npm run lint
node ./src/cli.js --root .
```

## GitHub Topics

Recommended topics:

```text
ai coding-agent cli developer-tools repository context-pack productivity
```

## Roadmap

- Add `.gitignore`-aware scanning.
- Add token-budgeted output modes.
- Add richer summaries for Python, TypeScript, Rust, and Go.
- Add GitHub Action mode for automatic context packs on pull requests.

## License

MIT
