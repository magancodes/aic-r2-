'use strict';

/**
 * Isolation gate: twin/ may not see plant/ or hidden physics names.
 * lib/ is shared and permitted. Run after every change to twin/.
 */

const fs = require('fs');
const path = require('path');

const TWIN_DIR = path.join(__dirname, '..', 'twin');
const BANNED = [
  /require\s*\(\s*['"]\.\.\/plant\//,
  /require\s*\(\s*['"]\.\/plant\//,
  /require\s*\(\s*['"]plant\//,
  /from\s+['"].*plant\//,
  /\bgroundTruth\b/,
  /\btipRatio\b/,
  /\bnugget\b/,
  /\baccelerated\b/,
  /degradation\.js/,
  /plant\/weld/,
];

const ALLOWED_SHARED = /require\s*\(\s*['"]\.\.\/lib\//;

let failed = 0;
const files = fs.readdirSync(TWIN_DIR).filter((f) => f.endsWith('.js'));

for (const f of files) {
  const src = fs.readFileSync(path.join(TWIN_DIR, f), 'utf8');
  for (const re of BANNED) {
    if (re.test(src)) {
      // Allow lib/ requires
      if (ALLOWED_SHARED.test(src) && String(re).includes('plant') === false) {
        // still check this match
      }
      console.error(`FAIL ${f}: matched ${re}`);
      failed += 1;
    }
  }
}

if (failed) {
  console.error(`check_isolation: ${failed} violation(s)`);
  process.exit(1);
}
console.log(`check_isolation: ok (${files.length} twin modules, lib/ permitted, plant/ banned)`);
