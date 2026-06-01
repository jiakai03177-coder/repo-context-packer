import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { internals, packRepository } from "../src/pack.js";

async function makeTempRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-context-packer-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "left-pad"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "sample-app",
      version: "1.0.0",
      scripts: { test: "node --test" },
      dependencies: { express: "^5.0.0" }
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "src", "index.js"),
    "export function main() {\n  return 'hello';\n}\n",
    "utf8"
  );
  await fs.writeFile(path.join(root, "node_modules", "left-pad", "index.js"), "module.exports = true;", "utf8");
  return root;
}

test("packRepository writes the expected context files", async () => {
  const root = await makeTempRepo();
  const outDir = path.join(root, ".context-pack");

  const result = await packRepository({ root, outDir });

  assert.equal(result.scannedFiles, 2);
  assert.equal(result.summarizedFiles, 2);
  await assert.doesNotReject(() => fs.access(path.join(outDir, "overview.md")));
  await assert.doesNotReject(() => fs.access(path.join(outDir, "file-map.md")));
  await assert.doesNotReject(() => fs.access(path.join(outDir, "dependencies.md")));
  await assert.doesNotReject(() => fs.access(path.join(outDir, "agent-prompt.md")));

  const fileMap = await fs.readFile(path.join(outDir, "file-map.md"), "utf8");
  assert.match(fileMap, /src\/index\.js/);
  assert.doesNotMatch(fileMap, /node_modules/);
});

test("package.json dependency summary is parsed", () => {
  const summary = internals.summarizePackageJson(
    JSON.stringify({
      name: "demo",
      scripts: { build: "tsc" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { typescript: "^5.0.0" }
    })
  );

  assert.deepEqual(summary.dependencies, ["react"]);
  assert.deepEqual(summary.devDependencies, ["typescript"]);
  assert.deepEqual(summary.scripts, ["build"]);
});

test("ignore rules skip generated directories", () => {
  assert.equal(internals.isIgnored("node_modules/pkg/index.js"), true);
  assert.equal(internals.isIgnored("src/index.js"), false);
});

test("packRepository respects common .gitignore patterns", async () => {
  const root = await makeTempRepo();
  await fs.writeFile(
    path.join(root, ".gitignore"),
    ["ignored-dir/", "*.txt", "logs/*.md", "!keep.txt"].join("\n"),
    "utf8"
  );
  await fs.mkdir(path.join(root, "ignored-dir"), { recursive: true });
  await fs.mkdir(path.join(root, "logs"), { recursive: true });
  await fs.writeFile(path.join(root, "ignored-dir", "index.js"), "export const hidden = true;", "utf8");
  await fs.writeFile(path.join(root, "token.txt"), "hidden", "utf8");
  await fs.writeFile(path.join(root, "logs", "debug.md"), "hidden", "utf8");
  await fs.writeFile(path.join(root, "keep.txt"), "visible", "utf8");

  const outDir = path.join(root, ".context-pack");
  await packRepository({ root, outDir });

  const fileMap = await fs.readFile(path.join(outDir, "file-map.md"), "utf8");
  assert.doesNotMatch(fileMap, /ignored-dir/);
  assert.doesNotMatch(fileMap, /token\.txt/);
  assert.doesNotMatch(fileMap, /logs\/debug\.md/);
  assert.match(fileMap, /keep\.txt/);
});

test("packRepository can cap agent prompt with a token budget", async () => {
  const root = await makeTempRepo();
  for (let index = 0; index < 30; index += 1) {
    const name = `feature-${String(index).padStart(2, "0")}.js`;
    await fs.writeFile(
      path.join(root, "src", name),
      `export function feature${index}() {\n  return "${"signal ".repeat(20)}";\n}\n`,
      "utf8"
    );
  }

  const outDir = path.join(root, ".context-pack");
  await packRepository({ root, outDir, tokenBudget: 450 });

  const agentPrompt = await fs.readFile(path.join(outDir, "agent-prompt.md"), "utf8");
  assert.ok(internals.estimateTokens(agentPrompt) <= 450);
  assert.match(agentPrompt, /Approximate token budget: 450/);
  assert.match(agentPrompt, /Some file signals were omitted/);
  assert.doesNotMatch(agentPrompt, /feature-29\.js/);
});
