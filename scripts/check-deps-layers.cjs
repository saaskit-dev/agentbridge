#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

// Guard: sync layer must not statically depend on UI/realtime layers.
const FORBIDDEN_IMPORT_RE = /^import\s+.*\s+from\s+['"]@\/(components|realtime)\//;
const TARGET_DIR = path.join(process.cwd(), 'apps/free/app/sources/sync');

function walk(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results = [];

  for (const e of entries) {
    const fullPath = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      results.push(...walk(fullPath));
      continue;
    }
    if (!e.isFile()) continue;
    results.push(fullPath);
  }

  return results;
}

function main() {
  try {
    if (!fs.existsSync(TARGET_DIR)) {
      process.stderr.write(`Layer check failed: target dir not found: ${TARGET_DIR}\n`);
      process.exit(2);
    }

    const allFiles = walk(TARGET_DIR);
    const tsFiles = allFiles.filter(f => {
      const ext = path.extname(f);
      if (ext !== '.ts' && ext !== '.tsx') return false;
      if (f.endsWith('.d.ts')) return false;
      return true;
    });

    const hits = [];
    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const rel = path.relative(process.cwd(), file);
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (FORBIDDEN_IMPORT_RE.test(line)) {
          hits.push(`${rel}:${i + 1}:${line.trim()}`);
        }
      }
    }

    if (hits.length > 0) {
      process.stderr.write('Forbidden static imports found in sync layer:\n');
      for (const h of hits) process.stderr.write(`${h}\n`);
      process.exit(1);
    }

    process.stdout.write('Layer check passed: no forbidden static imports in sync layer.\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write(`Layer check failed: ${String(e)}\n`);
    process.exit(2);
  }
}

main();
