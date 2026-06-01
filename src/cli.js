#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { packRepository } from "./pack.js";

function printHelp() {
  console.log(`repo-context-packer

Generate an AI-ready context pack for a repository.

Usage:
  repo-context-packer [options]

Options:
  --root <path>       Repository root to scan. Defaults to current directory.
  --out <path>        Output directory. Defaults to <root>/.context-pack.
  --max-files <n>     Maximum files to summarize. Defaults to 200.
  --help              Show this help message.

Examples:
  repo-context-packer
  repo-context-packer --root ../my-app --out ./context-pack
`);
}

function readArgs(argv) {
  const args = {
    root: process.cwd(),
    out: null,
    maxFiles: 200
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--root") {
      args.root = argv[++index];
      continue;
    }

    if (arg === "--out") {
      args.out = argv[++index];
      continue;
    }

    if (arg === "--max-files") {
      args.maxFiles = Number(argv[++index]);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(args.maxFiles) || args.maxFiles < 1) {
    throw new Error("--max-files must be a positive integer");
  }

  args.root = path.resolve(args.root);
  args.out = args.out ? path.resolve(args.out) : path.join(args.root, ".context-pack");
  return args;
}

try {
  const args = readArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = await packRepository({
    root: args.root,
    outDir: args.out,
    maxFiles: args.maxFiles
  });

  console.log(`Context pack written to ${result.outDir}`);
  console.log(`Scanned ${result.scannedFiles} files, summarized ${result.summarizedFiles} files.`);
  console.log("Created:");
  for (const file of result.createdFiles) {
    console.log(`  - ${file}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
