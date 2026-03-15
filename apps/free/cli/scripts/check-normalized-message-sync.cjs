#!/usr/bin/env node
/**
 * check-normalized-message-sync.cjs
 *
 * Verifies that the NormalizedMessage type in the CLI daemon matches the App's
 * source-of-truth definition in typesRaw.ts.
 *
 * Specifically checks:
 *  - NormalizedAgentContent discriminant types (text|thinking|tool-call|tool-result|summary|sidechain)
 *  - Required fields in each discriminant variant
 *  - NormalizedMessage base fields (id, localId, createdAt, isSidechain, meta, usage, traceId)
 *
 * Exits with code 1 and prints a diff if any mismatch is found.
 *
 * RFC-003 §"NormalizedMessage 类型重复定义" — required CI check.
 */

'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..', '..', '..');

const APP_TYPES_PATH = join(ROOT, 'apps/free/app/sources/sync/typesRaw.ts');
const CLI_TYPES_PATH = join(ROOT, 'apps/free/cli/src/daemon/sessions/types.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a block of text between balanced braces starting from `startIndex`.
 * Returns the content inside the outermost { }.
 */
function extractBlock(src, startIndex) {
  let depth = 0;
  let start = -1;
  for (let i = startIndex; i < src.length; i++) {
    if (src[i] === '{') {
      depth++;
      if (depth === 1) start = i;
    } else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  return null;
}

/**
 * Extract top-level property names from a TypeScript object type block.
 * Handles both single-line and multi-line formats.
 * Ignores nested object content (e.g. permissions?: { ... }).
 * Returns a sorted array of field names (with optional marker if present).
 */
function extractFields(block) {
  const fields = new Set();
  let i = 0;
  let depth = 0;

  // Tokenize: split on ';' and newlines, respecting brace depth
  let token = '';
  while (i < block.length) {
    const ch = block[i];
    if (ch === '{') {
      depth++;
      token += ch;
    } else if (ch === '}') {
      depth--;
      token += ch;
    } else if ((ch === ';' || ch === '\n') && depth === 0) {
      // Process the accumulated token as a potential property declaration
      const stripped = token.replace(/\/\/.*$/, '').trim();
      const match = stripped.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\?)?:/);
      if (match) {
        fields.add(match[1] + (match[2] ?? ''));
      }
      token = '';
    } else {
      token += ch;
    }
    i++;
  }
  // Handle last token
  const stripped = token.replace(/\/\/.*$/, '').trim();
  const match = stripped.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\?)?:/);
  if (match) {
    fields.add(match[1] + (match[2] ?? ''));
  }

  return [...fields].sort();
}

/**
 * Extract all discriminant variant blocks from a union type like:
 *   type Foo = { type: 'a'; ... } | { type: 'b'; ... }
 *
 * Returns a Map<discriminantValue, fieldList>.
 */
function extractDiscriminantVariants(src, typeName) {
  // Find the type alias declaration
  const declRe = new RegExp(`(?:export\\s+)?type\\s+${typeName}\\s*=`);
  const match = declRe.exec(src);
  if (!match) return null;

  const afterDecl = src.slice(match.index + match[0].length);

  // Collect all { ... } blocks that appear in the union (before the & or ;)
  // We stop at the first semicolon or `&` that isn't inside a block
  const variants = new Map();
  let i = 0;
  let depth = 0;

  while (i < afterDecl.length) {
    const ch = afterDecl[i];
    if (ch === '{') {
      if (depth === 0) {
        // New top-level block — extract its content
        const block = extractBlock(afterDecl, i);
        if (block) {
          // Find the discriminant: type: 'literal'
          const discMatch = block.match(/type\s*:\s*['"]([^'"]+)['"]/);
          if (discMatch) {
            variants.set(discMatch[1], extractFields(block));
          }
          // Skip past this block
          let nested = 0;
          while (i < afterDecl.length) {
            if (afterDecl[i] === '{') nested++;
            else if (afterDecl[i] === '}') {
              nested--;
              if (nested === 0) { i++; break; }
            }
            i++;
          }
          continue;
        }
      }
      depth++;
    } else if (ch === '}') {
      depth--;
    } else if (ch === ';' && depth === 0) {
      // End of type declaration
      break;
    } else if (ch === '&' && depth === 0) {
      // Intersection type — stop collecting variants
      break;
    }
    i++;
  }

  return variants;
}

/**
 * Extract the intersection base fields from NormalizedMessage (the & { ... } part).
 */
function extractNormalizedMessageBaseFields(src) {
  const declRe = /(?:export\s+)?type\s+NormalizedMessage\s*=/;
  const match = declRe.exec(src);
  if (!match) return [];

  const afterDecl = src.slice(match.index + match[0].length);

  // Find the & { ... } intersection part
  const ampIdx = afterDecl.indexOf('&');
  if (ampIdx === -1) return [];

  const afterAmp = afterDecl.slice(ampIdx + 1).trim();
  const block = extractBlock(afterAmp, afterAmp.indexOf('{'));
  if (!block) return [];

  return extractFields(block);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let appSrc, cliSrc;

try {
  appSrc = readFileSync(APP_TYPES_PATH, 'utf-8');
} catch {
  console.error(`[check-type-sync] Cannot read App types file: ${APP_TYPES_PATH}`);
  process.exit(1);
}

try {
  cliSrc = readFileSync(CLI_TYPES_PATH, 'utf-8');
} catch {
  console.error(`[check-type-sync] Cannot read CLI types file: ${CLI_TYPES_PATH}`);
  process.exit(1);
}

let hasError = false;

function reportMismatch(label, appValue, cliValue) {
  if (JSON.stringify(appValue) !== JSON.stringify(cliValue)) {
    console.error(`\n[check-type-sync] MISMATCH: ${label}`);
    console.error(`  App: ${JSON.stringify(appValue)}`);
    console.error(`  CLI: ${JSON.stringify(cliValue)}`);
    hasError = true;
  }
}

// --- Check NormalizedAgentContent variants ---

const appVariants = extractDiscriminantVariants(appSrc, 'NormalizedAgentContent');
const cliVariants = extractDiscriminantVariants(cliSrc, 'NormalizedAgentContent');

if (!appVariants || appVariants.size === 0) {
  console.error('[check-type-sync] Could not extract NormalizedAgentContent from App types');
  process.exit(1);
}
if (!cliVariants || cliVariants.size === 0) {
  console.error('[check-type-sync] Could not extract NormalizedAgentContent from CLI types');
  process.exit(1);
}

// Check all App variants exist in CLI
for (const [typeName, appFields] of appVariants) {
  const cliFields = cliVariants.get(typeName);
  if (!cliFields) {
    console.error(`\n[check-type-sync] MISSING variant in CLI: NormalizedAgentContent '${typeName}'`);
    console.error(`  App has: ${JSON.stringify(appFields)}`);
    hasError = true;
    continue;
  }
  reportMismatch(`NormalizedAgentContent['${typeName}'] fields`, appFields, cliFields);
}

// Check for CLI variants not in App (would be a CLI-side addition that may need App support)
for (const typeName of cliVariants.keys()) {
  if (!appVariants.has(typeName)) {
    console.warn(`[check-type-sync] WARNING: CLI has extra NormalizedAgentContent variant '${typeName}' not in App (may be intentional)`);
  }
}

// --- Check NormalizedMessage base fields ---

const appBaseFields = extractNormalizedMessageBaseFields(appSrc);
const cliBaseFields = extractNormalizedMessageBaseFields(cliSrc);

if (appBaseFields.length === 0) {
  console.error('[check-type-sync] Could not extract NormalizedMessage base fields from App');
  process.exit(1);
}
if (cliBaseFields.length === 0) {
  console.error('[check-type-sync] Could not extract NormalizedMessage base fields from CLI');
  process.exit(1);
}

reportMismatch('NormalizedMessage base fields', appBaseFields, cliBaseFields);

// --- Report ---

if (hasError) {
  console.error('\n[check-type-sync] FAILED: NormalizedMessage types are out of sync.');
  console.error(`  App source:  ${APP_TYPES_PATH}`);
  console.error(`  CLI source:  ${CLI_TYPES_PATH}`);
  console.error('  Update CLI daemon/sessions/types.ts to match the App definition.');
  process.exit(1);
} else {
  const variantList = [...appVariants.keys()].join(', ');
  console.log(`[check-type-sync] OK — NormalizedAgentContent variants: ${variantList}`);
  console.log(`[check-type-sync] OK — NormalizedMessage base fields: ${appBaseFields.join(', ')}`);
}
