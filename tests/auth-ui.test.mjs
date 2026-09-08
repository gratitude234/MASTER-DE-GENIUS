import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');

const { AuthField } = await import('../components/auth/auth-field.tsx');
const { InlineAlert } = await import('../components/ui/inline-alert.tsx');
const { passwordConfirmationFeedback } = await import('../features/auth/validation.ts');
const { validateTargetScore, TARGET_SCORE_MIN, TARGET_SCORE_MAX } = await import(
  '../features/onboarding/validation.ts'
);

const html = (element) => renderToStaticMarkup(element);
const h = React.createElement;

/** Pulls one attribute off the first tag of `name` in the markup. */
function attr(markup, tag, name) {
  const match = markup.match(new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`));
  return match ? match[1] : null;
}

test('field label points at the input it labels', () => {
  const markup = html(h(AuthField, { label: 'Email', name: 'email' }));
  const htmlFor = attr(markup, 'label', 'for');
  assert.ok(htmlFor, 'label carries a for attribute');
  assert.equal(attr(markup, 'input', 'id'), htmlFor);
});

test('a clean field advertises no error, description or reveal control', () => {
  const markup = html(h(AuthField, { label: 'Email', name: 'email' }));
  assert.ok(!markup.includes('aria-invalid'));
  assert.ok(!markup.includes('aria-describedby'));
  assert.ok(!markup.includes('<button'), 'reveal control is opt-in');
});

test('field error is announced through aria-describedby, not just colour', () => {
  const markup = html(h(AuthField, { label: 'Email', name: 'email', error: 'Enter a valid email address.' }));
  assert.equal(attr(markup, 'input', 'aria-invalid'), 'true');
  const describedBy = attr(markup, 'input', 'aria-describedby');
  assert.ok(describedBy, 'input is described');
  // The description must resolve to an element that exists and holds the copy.
  assert.ok(markup.includes(`id="${describedBy}"`));
  assert.ok(markup.includes('Enter a valid email address.'));
});

test('hint and error are both described, in reading order', () => {
  const markup = html(h(AuthField, { label: 'Target score', name: 'targetScore', hint: 'Between 180 and 400', error: 'Enter a target score.' }));
  const ids = attr(markup, 'input', 'aria-describedby').split(' ');
  assert.equal(ids.length, 2);
  for (const id of ids) assert.ok(markup.includes(`id="${id}"`));
});

test('a confirmation is described, and an error supersedes it', () => {
  const ok = html(h(AuthField, { label: 'Confirm', name: 'c', success: 'Passwords match.' }));
  assert.ok(ok.includes('Passwords match.'));
  assert.ok(attr(ok, 'input', 'aria-describedby'));

  // Never claim a match while the field is also reporting a problem.
  const clash = html(h(AuthField, { label: 'Confirm', name: 'c', success: 'Passwords match.', error: 'Passwords do not match.' }));
  assert.ok(!clash.includes('Passwords match.'));
  assert.ok(clash.includes('Passwords do not match.'));
});

test('password reveal control is labelled, toggle-shaped and never submits', () => {
  const markup = html(h(AuthField, { label: 'Password', name: 'password', type: 'password', revealable: true }));
  assert.ok(markup.includes('type="button"'), 'a reveal control inside a form must not submit it');
  assert.equal(attr(markup, 'button', 'aria-label'), 'Show password');
  assert.equal(attr(markup, 'button', 'aria-pressed'), 'false');
  // It has to say which field it reveals.
  assert.equal(attr(markup, 'button', 'aria-controls'), attr(markup, 'input', 'id'));
  // Untoggled, the field is still masked.
  assert.equal(attr(markup, 'input', 'type'), 'password');
});

test('inline alerts carry an icon and a live-region role per tone', () => {
  const failure = html(h(InlineAlert, { tone: 'danger' }, 'We could not sign you in.'));
  assert.ok(failure.includes('role="alert"'), 'failures interrupt');
  assert.ok(failure.includes('<svg'), 'meaning does not rest on colour alone');
  assert.ok(failure.includes('bg-danger-50'));

  const confirmation = html(h(InlineAlert, { tone: 'success' }, 'Password updated.'));
  assert.ok(confirmation.includes('role="status"'), 'confirmations wait their turn');
  assert.ok(confirmation.includes('bg-success-50'));
});

test('password confirmation stays silent until the student has typed one', () => {
  assert.deepEqual(passwordConfirmationFeedback('secret123', ''), {});
  assert.deepEqual(passwordConfirmationFeedback('', ''), {});
});

test('password confirmation reports mismatch and match without blocking submit', () => {
  assert.deepEqual(passwordConfirmationFeedback('secret123', 'secret124'), {
    error: 'Passwords do not match.',
  });
  assert.deepEqual(passwordConfirmationFeedback('secret123', 'secret123'), {
    success: 'Passwords match.',
  });
  // Wording matches signupAction/updatePasswordAction so it cannot change on submit.
  assert.equal(passwordConfirmationFeedback('a', 'b').error, 'Passwords do not match.');
});

test('target score validation matches the server bounds exactly', () => {
  assert.equal(TARGET_SCORE_MIN, 180);
  assert.equal(TARGET_SCORE_MAX, 400);

  for (const valid of ['180', '280', '400', ' 300 ']) {
    assert.equal(validateTargetScore(valid), undefined, `${valid} should pass`);
  }
  for (const invalid of ['179', '401', '280.5', '', '   ', 'abc']) {
    assert.ok(validateTargetScore(invalid), `${invalid} should fail`);
  }
});

test('WAEC percentage validation uses its own honest scale', () => {
  assert.equal(validateTargetScore('70', 'waec'), undefined);
  assert.match(validateTargetScore('101', 'waec'), /between 1 and 100/);
  assert.match(validateTargetScore('0', 'waec'), /percentage goal/);
});
