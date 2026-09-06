import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

// Server-action plumbing Next.js normally provides.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/navigation') {
      return stub(`export function redirect(url){ const e = new Error('NEXT_REDIRECT'); e.digest = 'NEXT_REDIRECT;' + url; throw e; }`);
    }
    if (specifier === 'next/headers') {
      return stub(`export async function headers(){ return new Map([['host','localhost:3000']]); }`);
    }
    if (specifier === '@/lib/supabase/server') {
      return stub(`export const createClient = async () => globalThis.__authClient;`);
    }
    return next(specifier, context);
  },
});

const { loginAction, signupAction, requestPasswordResetAction, updatePasswordAction } =
  await import('../features/auth/actions.ts');
const { requireUser, requireOnboardedUser } = await import('../lib/auth.ts');

/** Records every Supabase call so the tests can assert what auth actually did. */
function client({ signUp, signIn, user, profile, reset, update } = {}) {
  const calls = { signUp: [], signIn: [], select: [], reset: [], update: [], from: [] };
  globalThis.__authClient = {
    auth: {
      signUp: async (args) => { calls.signUp.push(args); return signUp ?? { data: { user: null, session: null }, error: null }; },
      signInWithPassword: async (args) => { calls.signIn.push(args); return signIn ?? { error: null }; },
      getUser: async () => ({ data: { user: user ?? null }, error: null }),
      resetPasswordForEmail: async (email, options) => { calls.reset.push({ email, options }); return reset ?? { error: null }; },
      updateUser: async (args) => { calls.update.push(args); return update ?? { error: null }; },
      signOut: async () => ({ error: null }),
    },
    from(table) {
      calls.from.push(table);
      const chain = {
        select(columns) { calls.select.push({ table, columns }); return chain; },
        eq() { return chain; },
        maybeSingle: async () => ({ data: profile ?? null, error: null }),
        insert() { throw new Error('signup must not insert a profile: the database trigger owns that'); },
        upsert() { throw new Error('signup must not upsert a profile: the database trigger owns that'); },
      };
      return chain;
    },
  };
  return calls;
}

/** Runs a server action, turning a thrown redirect back into a value. */
async function run(action, fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  try {
    return { state: await action(undefined, form) };
  } catch (error) {
    if (typeof error?.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT;')) {
      return { redirect: error.digest.slice('NEXT_REDIRECT;'.length) };
    }
    throw error;
  }
}

const VALID_SIGNUP = {
  fullName: 'Ifeoma Adaeze',
  email: 'Ifeoma@Example.com',
  password: 'correct-horse-battery',
  confirmPassword: 'correct-horse-battery',
};

const session = { access_token: 'token' };
const activeUser = { id: 'user-1', email: 'ifeoma@example.com' };

// --------------------------------------------------------------- signup ----

test('signup with a session redirects straight to onboarding', async () => {
  client({ signUp: { data: { user: activeUser, session }, error: null } });
  const result = await run(signupAction, VALID_SIGNUP);
  assert.equal(result.redirect, '/onboarding');
});

test('signup never produces a verification state or inbox message', async () => {
  const calls = client({ signUp: { data: { user: activeUser, session }, error: null } });
  const result = await run(signupAction, VALID_SIGNUP);

  assert.equal(result.redirect, '/onboarding');
  assert.ok(!result.redirect.includes('check-email'), 'signup must not route to the inbox screen');
  assert.equal(result.state, undefined, 'a successful signup returns no message state');

  // No confirmation callback is requested, so signup cannot depend on it.
  const options = calls.signUp[0].options ?? {};
  assert.equal('emailRedirectTo' in options, false, 'signup must not request an email confirmation redirect');
  assert.deepEqual(options.data, { full_name: 'Ifeoma Adaeze' });
});

test('signup does not create a second profile row', async () => {
  const calls = client({ signUp: { data: { user: activeUser, session }, error: null } });
  await run(signupAction, VALID_SIGNUP);
  // The fake client throws on insert/upsert; reaching here means neither ran.
  assert.deepEqual(calls.from, [], 'the on_auth_user_created trigger owns profile creation');
});

test('signup normalizes the email and keeps the password untouched', async () => {
  const calls = client({ signUp: { data: { user: activeUser, session }, error: null } });
  await run(signupAction, VALID_SIGNUP);
  assert.equal(calls.signUp[0].email, 'ifeoma@example.com');
  assert.equal(calls.signUp[0].password, 'correct-horse-battery');
});

test('a user created without a session gets an actionable error, not an inbox promise', async () => {
  client({ signUp: { data: { user: activeUser, session: null }, error: null } });
  const result = await run(signupAction, VALID_SIGNUP);

  assert.equal(result.redirect, undefined, 'must not redirect to a confirmation screen');
  assert.match(result.state.error, /account was created/i);
  assert.match(result.state.error, /sign in/i);
  assert.doesNotMatch(result.state.error, /inbox|verif|confirm/i, 'must not claim an email was sent');
});

test('signup with no user at all fails cleanly', async () => {
  client({ signUp: { data: { user: null, session: null }, error: null } });
  const result = await run(signupAction, VALID_SIGNUP);
  assert.equal(result.redirect, undefined);
  assert.match(result.state.error, /couldn't create your account/i);
});

test('a Supabase signup error is reported without leaking raw detail', async () => {
  client({ signUp: { data: { user: null, session: null }, error: { message: 'anonymous sign-ins are disabled: pgrst code 42501' } } });
  const result = await run(signupAction, VALID_SIGNUP);
  assert.equal(result.redirect, undefined);
  assert.match(result.state.error, /couldn't create your account/i);
  assert.doesNotMatch(result.state.error, /pgrst|42501/i, 'raw upstream detail must not reach the student');
});

test('a duplicate account is reported distinctly', async () => {
  client({ signUp: { data: { user: null, session: null }, error: { message: 'User already registered' } } });
  const result = await run(signupAction, VALID_SIGNUP);
  assert.match(result.state.error, /may already exist/i);
});

test('signup still validates its fields before calling Supabase', async () => {
  const calls = client();
  const result = await run(signupAction, { ...VALID_SIGNUP, confirmPassword: 'different' });
  assert.equal(result.state.fieldErrors.confirmPassword, 'Passwords do not match.');
  assert.deepEqual(calls.signUp, [], 'invalid input never reaches Supabase');
});

// ---------------------------------------------------------------- login ----

test('login succeeds without any confirmation check', async () => {
  const calls = client({ user: activeUser, profile: { onboarding_completed: true } });
  const result = await run(loginAction, { email: 'ifeoma@example.com', password: 'correct-horse-battery' });

  assert.equal(result.redirect, '/home');
  const columns = calls.select.map((call) => call.columns).join(' ');
  assert.doesNotMatch(columns, /confirmed_at/, 'login must not read a confirmation column');
});

test('login sends an un-onboarded user to onboarding', async () => {
  client({ user: activeUser, profile: { onboarding_completed: false } });
  const result = await run(loginAction, { email: 'ifeoma@example.com', password: 'correct-horse-battery' });
  assert.equal(result.redirect, '/onboarding');
});

test('login with a missing profile row still reaches onboarding', async () => {
  client({ user: activeUser, profile: null });
  const result = await run(loginAction, { email: 'ifeoma@example.com', password: 'correct-horse-battery' });
  assert.equal(result.redirect, '/onboarding', 'a trigger that has not landed yet must not break sign-in');
});

test('bad credentials are refused cleanly', async () => {
  client({ signIn: { error: { message: 'Invalid login credentials' } } });
  const result = await run(loginAction, { email: 'ifeoma@example.com', password: 'wrong-password-value' });
  assert.equal(result.redirect, undefined);
  assert.match(result.state.error, /couldn't sign you in/i);
});

// --------------------------------------------------------- route guards ----

test('an unauthenticated request is sent to login', async () => {
  client({ user: null });
  await assert.rejects(() => requireUser(), (error) => error.digest === 'NEXT_REDIRECT;/login');
  await assert.rejects(() => requireOnboardedUser(), (error) => error.digest === 'NEXT_REDIRECT;/login');
});

test('an authenticated user with incomplete onboarding is sent to onboarding', async () => {
  client({ user: activeUser, profile: { onboarding_completed: false } });
  await assert.rejects(() => requireOnboardedUser(), (error) => error.digest === 'NEXT_REDIRECT;/onboarding');
});

test('an authenticated user with completed onboarding passes the guard', async () => {
  client({ user: activeUser, profile: { id: 'user-1', full_name: 'Ifeoma', onboarding_completed: true } });
  const result = await requireOnboardedUser();
  assert.equal(result.user.id, 'user-1');
  assert.equal(result.profile.onboarding_completed, true);
});

test('no route guard reads an email-confirmation column', async () => {
  const calls = client({ user: activeUser, profile: { onboarding_completed: true } });
  await requireOnboardedUser();
  const columns = calls.select.map((call) => call.columns).join(' ');
  assert.ok(columns.length > 0, 'the guard does query the profile');
  assert.doesNotMatch(columns, /confirmed_at|email_confirmed/, 'guards gate on session and onboarding only');
});

// ------------------------------------------------ password reset (regression)

test('REGRESSION: password reset still emails a link through /auth/callback', async () => {
  const calls = client();
  const result = await run(requestPasswordResetAction, { email: 'Ifeoma@Example.com' });

  assert.equal(calls.reset[0].email, 'ifeoma@example.com');
  assert.match(calls.reset[0].options.redirectTo, /\/auth\/callback\?next=\/reset-password$/,
    'password recovery still depends on the callback route');
  assert.equal(result.redirect, '/check-email?mode=reset&email=ifeoma%40example.com');
});

test('REGRESSION: the reset confirmation screen is reachable only in reset mode', () => {
  const page = readFileSync(new URL('../app/(auth)/check-email/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /if \(mode !== "reset"\) redirect\("\/login"\)/, 'a non-reset visit is redirected away');
  assert.doesNotMatch(page, /confirmation link/i, 'the signup confirmation copy is gone');
});

test('REGRESSION: updating a password still returns the user to sign-in', async () => {
  client();
  const result = await run(updatePasswordAction, { password: 'brand-new-password', confirmPassword: 'brand-new-password' });
  assert.equal(result.redirect, '/login?password=updated');
});

test('REGRESSION: a failed password update reports a safe message', async () => {
  client({ update: { error: { message: 'token expired' } } });
  const result = await run(updatePasswordAction, { password: 'brand-new-password', confirmPassword: 'brand-new-password' });
  assert.match(result.state.error, /couldn't update your password/i);
  assert.doesNotMatch(result.state.error, /token expired/i);
});

// ------------------------------------------------------------ dead code ----

/** Comment-free view, so assertions about code are not fooled by comment prose. */
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Flattened view, so assertions about comment prose survive line wrapping. */
const asProse = (source) => source.replace(/\s*\n\s*\*?\s*/g, " ");

test('the signup path carries no email-confirmation wording or dependency', () => {
  const base = new URL('../', import.meta.url);
  const sources = [
    'features/auth/actions.ts',
    'components/auth/signup-form.tsx',
    'app/(auth)/signup/page.tsx',
  ].map((path) => readFileSync(new URL(path, base), 'utf8'));

  const action = sources[0];
  const signupBlock = codeOnly(action.slice(action.indexOf('export async function signupAction'), action.indexOf('export async function requestPasswordResetAction')));
  assert.doesNotMatch(signupBlock, /check-email/, 'signup must not redirect to the inbox screen');
  assert.doesNotMatch(signupBlock, /emailRedirectTo/, 'signup must not request a confirmation callback');
  assert.match(signupBlock, /redirect\("\/onboarding"\)/, 'signup lands on onboarding');

  for (const source of sources.slice(1)) {
    assert.doesNotMatch(source, /verify your email|verification email|check your inbox|confirm your email/i);
  }
});

test('the auth callback remains for password recovery', () => {
  const route = readFileSync(new URL('../app/auth/callback/route.ts', import.meta.url), 'utf8');
  assert.match(route, /exchangeCodeForSession/, 'the callback still exchanges a code for a session');
  assert.match(asProse(route), /password recovery/i, 'its remaining purpose is documented');
});
