import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `position: fixed` must keep measuring from the viewport.
 *
 * A CSS transform on an ancestor — including an identity one left behind by
 * `animation-fill-mode: both` — makes that ancestor the containing block for
 * fixed descendants. `.screen-enter` animated `translateY(6px)` on the page
 * wrapper, so every page-level fixed bar was positioned from the end of the
 * page content instead of the bottom of the screen.
 *
 * On a phone that put the practice runner's "Next question" bar and the CBT
 * runner's submit bar hundreds of pixels up the screen, over a band of dead
 * space, clipping the last answer option behind them. Measured at 390×844:
 * the practice bar sat 432px too high.
 *
 * The same trap applies to `filter`, `perspective`, `backdrop-filter`,
 * `contain: paint` and `will-change` on any of those.
 */

const GLOBALS = 'app/globals.css';

/** Page-level classes applied to wrappers that contain fixed positioning. */
const PAGE_WRAPPER_CLASSES = ['screen-enter'];

function keyframesFor(name, css) {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return null;
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(open, i + 1); }
  }
  return null;
}

test('no page-wrapper animation applies a transform', () => {
  const css = readFileSync(GLOBALS, 'utf8');

  for (const name of PAGE_WRAPPER_CLASSES) {
    const frames = keyframesFor(name, css);
    assert.ok(frames, `@keyframes ${name} should exist`);

    for (const property of ['transform', 'translate', 'rotate', 'scale', 'perspective', 'filter']) {
      assert.ok(
        !new RegExp(`(^|[;{\\s])${property}\\s*:`).test(frames),
        `@keyframes ${name} must not animate "${property}" — it would re-anchor every fixed bar on the page`,
      );
    }
  }
});

test('the page-wrapper class itself sets no containing-block property', () => {
  const css = readFileSync(GLOBALS, 'utf8');

  for (const name of PAGE_WRAPPER_CLASSES) {
    const start = css.indexOf(`.${name} {`);
    assert.ok(start >= 0, `.${name} should exist`);
    const block = css.slice(start, css.indexOf('}', start));

    for (const property of ['transform', 'translate', 'rotate', 'scale', 'filter', 'backdrop-filter', 'perspective', 'contain', 'will-change']) {
      assert.ok(
        !new RegExp(`(^|[;{\\s])${property}\\s*:`).test(block),
        `.${name} must not set "${property}" while page wrappers contain fixed elements`,
      );
    }
  }
});

/** Every component or page that applies a page-wrapper class. */
function wrapperFiles() {
  const found = [];
  const skip = new Set(['node_modules', '.next', '.git']);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!path.endsWith('.tsx')) continue;
      const source = readFileSync(path, 'utf8');
      if (PAGE_WRAPPER_CLASSES.some((name) => source.includes(name))) found.push({ path, source });
    }
  };
  walk('app'); walk('components');
  return found;
}

test('the screens that combine a page wrapper with fixed positioning are known', () => {
  /*
   * Not a prohibition — the combination is fine now. This records which screens
   * depend on the wrapper staying transform-free, so anyone reintroducing motion
   * sees exactly what they would break.
   */
  // Matched on the class tokens themselves: these strings are often built
  // inside cn(), so anchoring on `className=` would miss them.
  const affected = wrapperFiles()
    .filter(({ source }) => /\bfixed\s+inset-x-0\b/.test(source))
    .map(({ path }) => path.replace(/\\/g, '/'));

  assert.deepEqual(affected.sort(), [
    'components/exam/exam-attempt-runner.tsx',
    'components/practice/practice-session-runner.tsx',
  ], 'a screen started or stopped combining a page wrapper with a fixed bar — re-check the containing block');
});

test('the fixed bars still position from the shared clearance tokens', () => {
  // Both bars rely on the tokens rather than hand-written offsets, so the tab
  // bar height lives in exactly one place.
  const css = readFileSync(GLOBALS, 'utf8');
  assert.match(css, /--nav-height:\s*4rem/);
  assert.match(css, /--safe-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/,
    'the env() fallback must stay, or the calc becomes invalid and bottom resolves to auto');
  assert.match(css, /--nav-clearance:\s*calc\(var\(--nav-height\)\s*\+\s*var\(--safe-bottom\)\)/);

  const runner = readFileSync('components/practice/practice-session-runner.tsx', 'utf8');
  assert.ok(runner.includes('navClearance.bottom'), 'the practice bar uses the shared clearance token');
});
