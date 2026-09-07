import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

/*
 * Device storage and the two runners are stubbed rather than modified: these
 * tests exercise the PWA presentation only, and none of them may reach the
 * session engine.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === 'next/navigation') {
      return stub(`export function usePathname(){ return globalThis.__pathname ?? '/home'; }`);
    }
    if (specifier === '@/features/offline/storage') {
      return stub(`
        export async function listRecords(){ return globalThis.__records ?? []; }
        export async function readOwner(){ return globalThis.__owner ?? null; }
        export async function clearDevice(){ globalThis.__cleared = true; }
      `);
    }
    if (specifier === '@/components/exam/exam-attempt-runner') {
      return stub(`export function ExamAttemptRunner(){ return null; }`);
    }
    if (specifier === '@/components/practice/practice-session-runner') {
      return stub(`export function PracticeSessionRunner(){ return null; }`);
    }
    return next(specifier, context);
  },
});

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');

const {
  resolveAppStatus,
  setInstallState,
  subscribeInstallState,
  getInstallState,
  getServerInstallState,
  DISMISS_KEY,
} = await import('../components/pwa/install-state.ts');
const { AppStatusRow } = await import('../components/pwa/app-status-row.tsx');
const { PwaManager } = await import('../components/pwa/pwa-manager.tsx');
const { OfflineLauncher } = await import('../components/pwa/offline-launcher.tsx');

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const state = (overrides = {}) => ({ install: null, updateReady: false, iosGuidance: false, standalone: false, ...overrides });
const installEvent = { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) };

// ---- Install state: what may be offered, and when -------------------------

test('an install action is only ever offered when the browser has offered one', () => {
  assert.equal(resolveAppStatus(state()), 'unavailable');
  assert.equal(resolveAppStatus(state({ install: installEvent })), 'installable');
  // iOS never fires beforeinstallprompt, so it gets steps rather than a button.
  assert.equal(resolveAppStatus(state({ iosGuidance: true })), 'ios-guidance');
});

test('installed and update-ready outrank any install offer', () => {
  assert.equal(resolveAppStatus(state({ standalone: true })), 'installed');
  assert.equal(resolveAppStatus(state({ standalone: true, install: installEvent })), 'installed');
  // An update the student can act on matters more than re-offering installation.
  assert.equal(resolveAppStatus(state({ updateReady: true, standalone: true })), 'update-ready');
  assert.equal(resolveAppStatus(state({ updateReady: true, install: installEvent })), 'update-ready');
});

test('the server snapshot claims nothing about the device', () => {
  const server = getServerInstallState();
  assert.deepEqual(server, state());
  assert.equal(resolveAppStatus(server), 'unavailable');
});

test('the store notifies subscribers once per real change', () => {
  let calls = 0;
  const unsubscribe = subscribeInstallState(() => { calls += 1; });
  setInstallState({ updateReady: true });
  assert.equal(calls, 1);
  assert.equal(getInstallState().updateReady, true);
  setInstallState({ updateReady: true });
  assert.equal(calls, 1, 'an identical patch must not re-render every consumer');
  setInstallState({ updateReady: false });
  assert.equal(calls, 2);
  unsubscribe();
  setInstallState({ updateReady: true });
  assert.equal(calls, 2, 'unsubscribed consumers stop hearing about changes');
  setInstallState({ updateReady: false });
});

test('a dismissal is stored under a key sign-out already clears', () => {
  assert.ok(DISMISS_KEY.startsWith('mdg:'));
  assert.match(source('components/pwa/sign-out.tsx'), /startsWith\("mdg:"\)/);
});

// ---- The Home banner ------------------------------------------------------

test('the banner renders nothing until the browser and the device have been read', () => {
  globalThis.__pathname = '/home';
  assert.equal(renderToStaticMarkup(React.createElement(PwaManager)), '');
});

test('the banner waits for a session to exist on the device before appearing', () => {
  const pwa = source('components/pwa/pwa-manager.tsx');
  // The regression this replaces: prompting on Home the moment onboarding ended.
  assert.match(pwa, /usedProduct !== true/);
  assert.match(pwa, /pathname === "\/home"/);
  assert.match(pwa, /dismissed/);
});

test('the banner is passive and never seizes focus', () => {
  const pwa = source('components/pwa/pwa-manager.tsx');
  assert.match(pwa, /role="status"/);
  assert.doesNotMatch(pwa, /role="alert"/);
  assert.doesNotMatch(pwa, /autoFocus|\.focus\(\)/);
  // Its only icon-only control is named.
  assert.match(pwa, /aria-label="Dismiss app options"/);
});

test('the banner never activates a waiting worker', () => {
  const pwa = source('components/pwa/pwa-manager.tsx');
  assert.doesNotMatch(pwa, /skipWaiting|SKIP_WAITING/);
  assert.doesNotMatch(pwa, /location\.reload|controllerchange/);
  // Registration options are still the ones the service worker was built around.
  assert.match(pwa, /scope: "\/", updateViaCache: "none"/);
});

// ---- The Profile row ------------------------------------------------------

test('the Profile row offers no install action the browser has not authorised', () => {
  const html = renderToStaticMarkup(React.createElement(AppStatusRow));
  assert.doesNotMatch(html, /Install app/);
  assert.match(html, /App/);
});

test('the Profile row states its status in words, never colour alone', () => {
  const html = renderToStaticMarkup(React.createElement(AppStatusRow));
  assert.match(html, /Up to date/);
  const row = source('components/pwa/app-status-row.tsx');
  for (const label of ['Installed', 'Update ready', 'Not installed', 'Up to date']) {
    assert.ok(row.includes(`label: "${label}"`), `${label} must be a written label`);
  }
});

test('no PWA status is explained in technical language', () => {
  const row = source('components/pwa/app-status-row.tsx');
  const copy = [...row.matchAll(/(?:label|detail):\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(copy.length >= 8, 'expected every status to carry a label and a detail');
  const technical = /service worker|serviceworker|indexeddb|skipwaiting|sw\.js|cache storage|manifest|beforeinstallprompt|http|supabase/i;
  for (const line of copy) {
    assert.doesNotMatch(line, technical, `student copy leaked an implementation detail: ${line}`);
  }
});

// ---- Offline launcher -----------------------------------------------------

test('removing device data no longer uses a native confirm', () => {
  const launcher = source('components/pwa/offline-launcher.tsx');
  assert.doesNotMatch(launcher, /window\.confirm|\bconfirm\(/);
  assert.match(launcher, /<Sheet/);
});

test('the removal confirmation is honest about what leaves the device', () => {
  const launcher = source('components/pwa/offline-launcher.tsx');
  assert.match(launcher, /Nothing is deleted from your account/);
  assert.match(launcher, /not reached the server yet/);
  assert.match(launcher, /Every answer here has already reached the server/);
  // The destructive choice is not the quiet one, and cancelling is available.
  assert.match(launcher, /variant="danger"[\s\S]{0,120}Remove from this device/);
  assert.match(launcher, /Keep saved data/);
});

test('the clear sequence itself is unchanged', () => {
  const launcher = source('components/pwa/offline-launcher.tsx');
  assert.match(launcher, /await clearDevice\(\);/);
  assert.match(launcher, /postMessage\(\{ type: "CLEAR_MEDIA" \}\)/);
});

test('the launcher renders its shared-device warning', () => {
  globalThis.__records = [];
  globalThis.__owner = null;
  const html = renderToStaticMarkup(React.createElement(OfflineLauncher));
  assert.match(html, /Anyone using this browser can access its saved sessions/);
  assert.match(html, /Your saved sessions/);
  // A closed Sheet contributes no markup, so nothing destructive is pre-rendered.
  assert.doesNotMatch(html, /Remove from this device/);
});

// ---- Design system --------------------------------------------------------

test('no PWA surface still uses raw product blue', () => {
  const files = readdirSync(new URL('../components/pwa/', import.meta.url));
  assert.ok(files.length >= 8);
  for (const file of files) {
    const contents = source(`components/pwa/${file}`);
    assert.doesNotMatch(contents, /\b(?:bg|text|border|ring|from|to|via)-(?:blue|indigo)-\d/, `${file} still uses raw blue/indigo`);
  }
});
