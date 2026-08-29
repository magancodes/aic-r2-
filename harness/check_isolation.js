'use strict';

/**
 * Isolation gate: twin/ may not import plant/ or use hidden-physics names.
 * lib/ is shared and permitted. Run after every change to twin/.
 *
 * The scan runs over CODE only — line and block comments are stripped first —
 * so a docstring that explains what the twin is deliberately kept blind to
 * (e.g. "twin reimplements DR features, never importing the plant synthesizer")
 * is not itself a violation. Actual imports and identifier use still trip it.
 */

const fs = require('fs');
const path = require('path');

const TWIN_DIR = path.join(__dirname, '..', 'twin');

// Any of these appearing in twin/ code means the isolation boundary leaked.
const BANNED = [
  { re: /require\s*\(\s*['"][^'"]*\bplant\//, why: 'imports plant/' },
  { re: /from\s+['"][^'"]*\bplant\//, why: 'imports plant/' },
  { re: /\bgroundTruth\b/, why: 'reads hidden ground truth' },
  { re: /\btipRatio\b/, why: 'uses hidden physics: tipRatio' },
  { re: /\bnugget\b/, why: 'uses hidden physics: nugget' },
  { re: /\baccelerated\b/, why: 'uses hidden physics: accelerated wear flag' },
  { re: /degradation\.js/, why: 'references the hidden degradation model' },
];

/** Remove // line comments and block comments so we scan code, not prose. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

let failed = 0;
const files = fs.readdirSync(TWIN_DIR).filter((f) => f.endsWith('.js'));

for (const f of files) {
  const raw = fs.readFileSync(path.join(TWIN_DIR, f), 'utf8');
  const code = stripComments(raw);
  const lines = code.split('\n');
  for (const { re, why } of BANNED) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        console.error(`FAIL ${f}:${i + 1}  ${why}  [${lines[i].trim()}]`);
        failed += 1;
      }
    }
  }
}

if (failed) {
  console.error(`check_isolation: ${failed} violation(s)`);
  process.exit(1);
}
console.log(`check_isolation: ok (${files.length} twin modules, lib/ permitted, plant/ banned)`);
