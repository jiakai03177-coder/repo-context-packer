import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  ".context-pack",
  ".git",
  ".hg",
  ".idea",
  ".next",
  ".nuxt",
  ".pytest_cache",
  ".turbo",
  ".venv",
  ".vscode",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor"
]);

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml"
]);

const MANIFEST_NAMES = new Set([
  "Cargo.toml",
  "go.mod",
  "package.json",
  "pnpm-lock.yaml",
  "pyproject.toml",
  "requirements.txt",
  "yarn.lock"
]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function globToRegex(pattern, options = {}) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(options.exact === false ? escaped : `^${escaped}$`);
}

function parseIgnoreRules(text) {
  const rules = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const negated = line.startsWith("!");
    const cleanLine = negated ? line.slice(1) : line;
    const directoryOnly = cleanLine.endsWith("/");
    const anchored = cleanLine.startsWith("/");
    const pattern = cleanLine.replace(/^\/+|\/+$/g, "");

    if (pattern) {
      rules.push({ anchored, directoryOnly, negated, pattern });
    }
  }

  return rules;
}

function matchesIgnoreRule(relativePath, rule) {
  const normalized = toPosix(relativePath);
  const parts = normalized.split("/");
  const hasSlash = rule.pattern.includes("/");
  const regex = globToRegex(rule.pattern);

  if (rule.directoryOnly) {
    const directories = parts.slice(0, -1);
    if (!hasSlash) {
      return directories.some((part) => regex.test(part));
    }

    if (rule.anchored) {
      return normalized.startsWith(`${rule.pattern}/`);
    }

    return directories.some((_, index) => regex.test(directories.slice(index).join("/")));
  }

  if (!hasSlash) {
    return parts.some((part) => regex.test(part));
  }

  if (rule.anchored) {
    return regex.test(normalized);
  }

  return regex.test(normalized) || globToRegex(`*/${rule.pattern}`).test(normalized);
}

function isIgnored(relativePath, extraIgnores = new Set(), ignoreRules = []) {
  const parts = toPosix(relativePath).split("/");
  if (parts.some((part) => DEFAULT_IGNORES.has(part) || extraIgnores.has(part))) {
    return true;
  }

  let ignored = false;
  for (const rule of ignoreRules) {
    if (matchesIgnoreRule(relativePath, rule)) {
      ignored = !rule.negated;
    }
  }

  return ignored;
}

function isTextLike(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || MANIFEST_NAMES.has(base) || base.startsWith(".");
}

async function walk(root, options = {}) {
  const files = [];
  const extraIgnores = options.extraIgnores ?? new Set();
  const ignoreRules = options.ignoreRules ?? [];

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);

      if (isIgnored(relative, extraIgnores, ignoreRules)) {
        continue;
      }

      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }

      if (!entry.isFile() || !isTextLike(absolute)) {
        continue;
      }

      const stats = await fs.stat(absolute);
      files.push({
        absolute,
        relative: toPosix(relative),
        size: stats.size,
        ext: path.extname(entry.name).toLowerCase()
      });
    }
  }

  await visit(root);
  return files;
}

async function readText(filePath, maxBytes) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function title(value) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function languageFor(file) {
  const name = path.basename(file.relative);
  if (name === "package.json") return "Node.js";
  if (name === "pyproject.toml" || name === "requirements.txt") return "Python";
  if (name === "Cargo.toml") return "Rust";
  if (name === "go.mod") return "Go";

  const byExt = {
    ".c": "C/C++",
    ".cc": "C/C++",
    ".cpp": "C/C++",
    ".cs": "C#",
    ".go": "Go",
    ".h": "C/C++",
    ".hpp": "C/C++",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".py": "Python",
    ".rs": "Rust",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".vue": "Vue"
  };

  return byExt[file.ext] ?? "Text";
}

function extractSignals(text) {
  const lines = text.split(/\r?\n/);
  const signals = [];
  const patterns = [
    /^\s*(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)/,
    /^\s*(export\s+)?class\s+([A-Za-z0-9_$]+)/,
    /^\s*(export\s+)?const\s+([A-Za-z0-9_$]+)\s*=/,
    /^\s*def\s+([A-Za-z0-9_]+)/,
    /^\s*class\s+([A-Za-z0-9_]+)/,
    /^\s*func\s+([A-Za-z0-9_]+)/,
    /^\s*pub\s+fn\s+([A-Za-z0-9_]+)/
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        signals.push(line.trim());
        break;
      }
    }

    if (signals.length >= 8) {
      return signals;
    }
  }

  return signals;
}

function firstMeaningfulLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("#"))
    .slice(0, 4);
}

function summarizeTextFile(file, text) {
  const signals = extractSignals(text);
  const firstLines = firstMeaningfulLines(text);
  return {
    path: file.relative,
    language: languageFor(file),
    size: file.size,
    signals,
    preview: firstLines
  };
}

function summarizePackageJson(text) {
  try {
    const data = JSON.parse(text);
    return {
      name: data.name ?? null,
      version: data.version ?? null,
      type: data.type ?? null,
      scripts: Object.keys(data.scripts ?? {}),
      dependencies: Object.keys(data.dependencies ?? {}),
      devDependencies: Object.keys(data.devDependencies ?? {})
    };
  } catch {
    return null;
  }
}

function renderOverview({ root, files, summaries }) {
  const languageCounts = new Map();
  for (const file of files) {
    const language = languageFor(file);
    languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }

  const languages = [...languageCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([language, count]) => `- ${language}: ${count}`)
    .join("\n");

  const topDirs = [...new Set(files.map((file) => file.relative.split("/")[0]))]
    .slice(0, 20)
    .map((dir) => `- ${dir}`)
    .join("\n");

  const notableFiles = summaries
    .filter((summary) => summary.signals.length > 0)
    .slice(0, 12)
    .map((summary) => `- \`${summary.path}\`: ${summary.signals.slice(0, 3).join("; ")}`)
    .join("\n");

  return `# Repository Context

Generated by repo-context-packer.

## Root

\`${root}\`

## Snapshot

- Files scanned: ${files.length}
- Files summarized: ${summaries.length}
- Generated at: ${new Date().toISOString()}

## Language Mix

${languages || "- No source files detected"}

## Top-Level Paths

${topDirs || "- No top-level paths detected"}

## Notable Code Signals

${notableFiles || "- No functions, classes, or exports detected in summarized files"}
`;
}

function renderFileMap(files, summaries) {
  const summaryByPath = new Map(summaries.map((summary) => [summary.path, summary]));
  const lines = ["# File Map", ""];

  for (const file of files) {
    const summary = summaryByPath.get(file.relative);
    const details = summary?.signals?.length
      ? ` - ${summary.signals.slice(0, 2).join("; ")}`
      : "";
    lines.push(`- \`${file.relative}\` (${languageFor(file)}, ${file.size} bytes)${details}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderDependencies(manifests) {
  const lines = ["# Dependencies", ""];

  if (manifests.length === 0) {
    lines.push("No common dependency manifests were found.");
    return `${lines.join("\n")}\n`;
  }

  for (const manifest of manifests) {
    lines.push(`## ${manifest.path}`);
    if (manifest.packageJson) {
      const pkg = manifest.packageJson;
      lines.push("");
      lines.push(`- Name: ${pkg.name ?? "unknown"}`);
      lines.push(`- Version: ${pkg.version ?? "unknown"}`);
      lines.push(`- Module type: ${pkg.type ?? "unspecified"}`);
      lines.push(`- Scripts: ${pkg.scripts.length ? pkg.scripts.join(", ") : "none"}`);
      lines.push(`- Dependencies: ${pkg.dependencies.length ? pkg.dependencies.join(", ") : "none"}`);
      lines.push(`- Dev dependencies: ${pkg.devDependencies.length ? pkg.devDependencies.join(", ") : "none"}`);
    } else {
      lines.push("");
      lines.push("```text");
      lines.push(manifest.preview.trim() || "(empty)");
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function renderPromptText({ root, summaries, fileLines, tokenBudget, truncated }) {
  const budgetLines = tokenBudget
    ? `Approximate token budget: ${tokenBudget}\nIncluded file signals: ${fileLines.length}/${summaries.length}\n\n`
    : "";
  const truncationNote = truncated
    ? "\nSome file signals were omitted to stay within the requested token budget.\n"
    : "";

  return `# Agent Prompt

You are working in this repository:

\`${root}\`

Start by reading:

1. \`.context-pack/overview.md\`
2. \`.context-pack/file-map.md\`
3. \`.context-pack/dependencies.md\`

${budgetLines}Important files and signals:

${fileLines.join("\n") || "- No summarized files were available."}
${truncationNote}
When editing this repository, preserve existing style, keep changes scoped, and run the relevant tests or checks before finishing.
`;
}

function renderAgentPrompt({ root, summaries, tokenBudget = null }) {
  const candidateLines = summaries
    .slice(0, 40)
    .map((summary) => {
      const signals = summary.signals.length ? summary.signals.join("; ") : summary.preview.join(" / ");
      return `- ${summary.path}: ${signals || "text file"}`;
    });

  if (!tokenBudget) {
    return renderPromptText({
      root,
      summaries,
      fileLines: candidateLines,
      tokenBudget,
      truncated: false
    });
  }

  const fileLines = [];
  let truncated = false;

  for (const line of candidateLines) {
    const candidate = [...fileLines, line];
    const prompt = renderPromptText({
      root,
      summaries,
      fileLines: candidate,
      tokenBudget,
      truncated: candidate.length < candidateLines.length
    });

    if (estimateTokens(prompt) <= tokenBudget) {
      fileLines.push(line);
    } else {
      truncated = true;
      break;
    }
  }

  if (fileLines.length < candidateLines.length) {
    truncated = true;
  }

  return renderPromptText({ root, summaries, fileLines, tokenBudget, truncated });
}

async function collectManifests(files, maxBytes) {
  const manifests = [];

  for (const file of files.filter((candidate) => MANIFEST_NAMES.has(path.basename(candidate.relative)))) {
    const text = await readText(file.absolute, maxBytes);
    manifests.push({
      path: file.relative,
      preview: text.split(/\r?\n/).slice(0, 80).join("\n"),
      packageJson: path.basename(file.relative) === "package.json" ? summarizePackageJson(text) : null
    });
  }

  return manifests;
}

export async function packRepository(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = path.resolve(options.outDir ?? path.join(root, ".context-pack"));
  const maxFiles = options.maxFiles ?? 200;
  const maxFileBytes = options.maxFileBytes ?? 80_000;
  const tokenBudget = options.tokenBudget ?? null;
  const outRelative = path.relative(root, outDir);
  const extraIgnores = new Set(outRelative && !outRelative.startsWith("..") ? [outRelative.split(path.sep)[0]] : []);
  let ignoreRules = [];
  const gitignorePath = path.join(root, ".gitignore");
  try {
    const gitignoreText = await fs.readFile(gitignorePath, "utf8");
    ignoreRules = parseIgnoreRules(gitignoreText);
  } catch {
    // Missing .gitignore is fine; the built-in ignores still apply.
  }

  await fs.access(root);
  const files = await walk(root, { extraIgnores, ignoreRules });
  const selected = files.slice(0, maxFiles);
  const summaries = [];

  for (const file of selected) {
    const text = await readText(file.absolute, maxFileBytes);
    summaries.push(summarizeTextFile(file, text));
  }

  const manifests = await collectManifests(files, maxFileBytes);
  await fs.mkdir(outDir, { recursive: true });

  const outputs = new Map([
    ["overview.md", renderOverview({ root, files, summaries })],
    ["file-map.md", renderFileMap(files, summaries)],
    ["dependencies.md", renderDependencies(manifests)],
    ["agent-prompt.md", renderAgentPrompt({ root, summaries, tokenBudget })]
  ]);

  for (const [fileName, content] of outputs.entries()) {
    await fs.writeFile(path.join(outDir, fileName), content, "utf8");
  }

  return {
    outDir,
    scannedFiles: files.length,
    summarizedFiles: summaries.length,
    createdFiles: [...outputs.keys()].map((fileName) => path.join(outDir, fileName))
  };
}

export const internals = {
  isIgnored,
  isTextLike,
  estimateTokens,
  languageFor,
  parseIgnoreRules,
  summarizePackageJson,
  title
};
