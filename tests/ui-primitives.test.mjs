import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');

const { Button } = await import('../components/ui/button.tsx');
const { Badge } = await import('../components/ui/badge.tsx');
const { Select } = await import('../components/ui/select.tsx');
const { Sheet } = await import('../components/ui/sheet.tsx');
const { Skeleton } = await import('../components/ui/skeleton.tsx');
const { EmptyState } = await import('../components/ui/empty-state.tsx');
const { ErrorState } = await import('../components/ui/error-state.tsx');
const {
  buttonClasses,
  buttonSizeClasses,
  badgeToneClasses,
  navClearance,
  radius,
} = await import('../components/ui/variants.ts');

const html = (element) => renderToStaticMarkup(element);
const h = React.createElement;

/** The class list of the outermost element, so assertions stay off deep markup. */
function rootClasses(markup) {
  return (markup.match(/^<[a-z0-9]+[^>]*\sclass="([^"]*)"/) ?? [, ''])[1].split(/\s+/);
}

test('button renders every variant with its own surface colour', () => {
  const surface = {
    primary: 'bg-brand-500',
    secondary: 'bg-white',
    ghost: 'bg-transparent',
    danger: 'bg-danger-600',
    dark: 'bg-slate-950',
  };

  for (const [variant, expected] of Object.entries(surface)) {
    const classes = rootClasses(html(h(Button, { variant }, 'Go')));
    assert.ok(classes.includes(expected), `${variant} should use ${expected}`);
  }

  // Every variant keeps the control radius and one focus treatment.
  for (const variant of Object.keys(surface)) {
    const classes = rootClasses(html(h(Button, { variant }, 'Go')));
    assert.ok(classes.includes(radius.control));
    assert.ok(classes.includes('focus-visible:ring-2'));
  }
});

test('button sizes map to the approved control heights', () => {
  const heights = { sm: 'h-9', md: 'h-11', lg: 'h-12', xl: 'h-[52px]' };

  for (const [size, height] of Object.entries(heights)) {
    assert.ok(rootClasses(html(h(Button, { size }, 'Go'))).includes(height));
  }

  // md, lg and xl clear the 44px touch minimum; xl is the CBT-critical CTA.
  assert.ok(buttonSizeClasses.xl.includes('h-[52px]'));
  assert.equal(Object.keys(buttonSizeClasses).length, 4);
});

test('button defaults to primary at md and leaves the native type alone', () => {
  const markup = html(h(Button, null, 'Go'));
  const classes = rootClasses(markup);
  assert.ok(classes.includes('bg-brand-500'));
  assert.ok(classes.includes('h-11'));
  // A submit button inside a form must keep submitting after migration.
  assert.ok(!markup.includes('type="button"'));
});

test('disabled button is inert and dimmed', () => {
  const markup = html(h(Button, { disabled: true }, 'Go'));
  assert.ok(markup.includes('disabled='));
  const classes = rootClasses(markup);
  assert.ok(classes.includes('disabled:opacity-50'));
  assert.ok(classes.includes('disabled:pointer-events-none'));
});

test('loading button disables itself and keeps the label boxed to avoid layout shift', () => {
  const markup = html(h(Button, { loading: true, loadingLabel: 'Building session' }, 'Start'));
  assert.ok(markup.includes('disabled='));
  assert.ok(markup.includes('aria-busy="true"'));
  assert.ok(markup.includes('Building session'));
  // The label is hidden, not unmounted, so the button keeps its width.
  assert.ok(markup.includes('invisible'));
  assert.ok(markup.includes('Start'));
});

test('icon-only button collapses to a square that still matches its size', () => {
  const classes = rootClasses(html(h(Button, { iconOnly: true, size: 'lg', 'aria-label': 'Close' }, '×')));
  assert.ok(classes.includes('h-12'));
  assert.ok(classes.includes('w-12'));
  assert.ok(classes.includes('px-0'));
  assert.ok(html(h(Button, { iconOnly: true, 'aria-label': 'Close' }, '×')).includes('aria-label="Close"'));
});

test('button consumers can override classes without duplicating conflicts', () => {
  // tailwind-merge keeps the caller's height and drops the recipe's.
  const classes = buttonClasses({ size: 'md', className: 'h-14' }).split(/\s+/);
  assert.ok(classes.includes('h-14'));
  assert.ok(!classes.includes('h-11'));
});

test('badge renders each semantic tone and never leans on colour alone', () => {
  for (const tone of Object.keys(badgeToneClasses)) {
    const markup = html(h(Badge, { tone }, 'Flagged'));
    const classes = rootClasses(markup);
    for (const expected of badgeToneClasses[tone].split(/\s+/)) {
      assert.ok(classes.includes(expected), `${tone} should include ${expected}`);
    }
    // The text label is the real signal; it is always present.
    assert.ok(markup.includes('Flagged'));
  }

  assert.deepEqual(Object.keys(badgeToneClasses), ['neutral', 'brand', 'success', 'warning', 'danger']);
});

test('badge dot is decorative and defaults off', () => {
  assert.ok(!html(h(Badge, null, 'Saved')).includes('aria-hidden'));
  assert.ok(html(h(Badge, { tone: 'success', dot: true }, 'Saved')).includes('aria-hidden="true"'));
});

test('select carries the form chrome, a chevron and a validation hook', () => {
  const markup = html(h(Select, { defaultValue: 'a' }, h('option', { value: 'a' }, 'A')));
  assert.ok(markup.includes('appearance-none'));
  assert.ok(markup.includes('h-12'), 'default control height is 48px');
  assert.ok(markup.includes('<svg'), 'chevron affordance is rendered');
  assert.ok(!markup.includes('aria-invalid'));

  const invalid = html(h(Select, { invalid: true }, h('option', null, 'A')));
  assert.ok(invalid.includes('aria-invalid="true"'));
  assert.ok(invalid.includes('border-danger-400'));

  assert.ok(html(h(Select, { size: 'md' }, h('option', null, 'A'))).includes('h-11'));
});

test('skeleton is decorative, animated and geometry-free', () => {
  const markup = html(h(Skeleton, { className: 'h-24 w-full rounded-2xl' }));
  assert.ok(markup.includes('aria-hidden="true"'));
  assert.ok(markup.includes('animate-pulse'));
  assert.ok(markup.includes('motion-reduce:animate-none'));
  assert.ok(markup.includes('h-24'));
});

test('empty state renders without a CTA', () => {
  const markup = html(h(EmptyState, { title: 'No attempts yet', description: 'Start a practice set.' }));
  assert.ok(markup.includes('No attempts yet'));
  assert.ok(markup.includes('Start a practice set.'));
  assert.ok(!markup.includes('<button'));
  assert.ok(markup.includes('<h3'), 'defaults to an h3 in the document outline');
});

test('empty state renders primary and secondary actions when given', () => {
  const markup = html(
    h(EmptyState, {
      title: 'No mistakes yet',
      action: h(Button, { variant: 'dark' }, 'Start practice'),
      secondaryAction: h('a', { href: '/progress' }, 'View progress'),
      headingLevel: 2,
    }),
  );
  assert.ok(markup.includes('Start practice'));
  assert.ok(markup.includes('View progress'));
  assert.ok(markup.includes('<h2'));
});

test('error state stays student-safe and offers no retry unless asked', () => {
  const markup = html(h(ErrorState));
  assert.ok(markup.includes('Something went wrong'));
  assert.ok(markup.includes('role="status"'));
  assert.ok(!markup.includes('<button'), 'no retry control without an onRetry handler');
});

test('error state renders the retry action when a handler is supplied', () => {
  const markup = html(h(ErrorState, { onRetry: () => {}, retryLabel: 'Reload results' }));
  assert.ok(markup.includes('<button'));
  assert.ok(markup.includes('Reload results'));
  assert.ok(markup.includes('type="button"'));
});

test('closed sheet renders nothing and stays out of the accessibility tree', () => {
  const markup = html(h(Sheet, { open: false, onClose: () => {}, title: 'Question navigator' }, 'body'));
  assert.ok(markup.startsWith('<dialog'));
  assert.ok(!markup.includes('open='), 'a closed dialog is display:none via the UA stylesheet');
  assert.ok(!markup.includes('body'));
});

test('open sheet exposes an accessible name, description and close affordance', () => {
  const markup = html(
    h(
      Sheet,
      { open: true, onClose: () => {}, title: 'Submit your paper', description: '3 questions are unanswered.' },
      'body content',
    ),
  );

  const labelledBy = markup.match(/aria-labelledby="([^"]+)"/);
  const describedBy = markup.match(/aria-describedby="([^"]+)"/);
  assert.ok(labelledBy, 'dialog is labelled');
  assert.ok(describedBy, 'dialog is described');
  // Both hooks must point at elements that actually exist in the panel.
  assert.ok(markup.includes(`id="${labelledBy[1]}"`));
  assert.ok(markup.includes(`id="${describedBy[1]}"`));
  assert.ok(markup.includes('Submit your paper'));
  assert.ok(markup.includes('3 questions are unanswered.'));
  assert.ok(markup.includes('aria-label="Close Submit your paper"'));
  // The panel takes focus itself rather than the first control inside it.
  assert.ok(markup.includes('tabindex="-1"'));
});

test('a non-dismissible sheet offers no close button', () => {
  const markup = html(
    h(Sheet, { open: true, onClose: () => {}, dismissible: false, title: 'Submitting' }, 'body'),
  );
  assert.ok(!markup.includes('aria-label="Close Submitting"'));
  assert.ok(markup.includes('Submitting'));
});

test('a visually hidden sheet title is still announced', () => {
  const markup = html(
    h(Sheet, { open: true, onClose: () => {}, hideTitle: true, title: 'Questions' }, 'body'),
  );
  assert.ok(markup.includes('sr-only'));
  assert.ok(markup.includes('Questions'));
});

test('tab-bar clearance has exactly one source of truth', () => {
  // The 4.25rem/4.5rem split is why these are tokens and not literals.
  assert.deepEqual(navClearance, {
    bottom: 'bottom-nav-clearance',
    padding: 'pb-nav-clearance',
    height: 'h-nav-height',
  });
});
