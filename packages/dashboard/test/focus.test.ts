import { beforeEach, describe, expect, it } from 'vitest';
import { preserveFocusWithin } from '../src/focus.js';

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  container.id = 'filters';
  document.body.appendChild(container);
});

/** Rebuilds the container's controls from scratch, exactly as renderFilters does. */
function renderControls(): void {
  container.innerHTML = '';
  for (const id of ['filter-site', 'filter-profile']) {
    const select = document.createElement('select');
    select.id = id;
    container.appendChild(select);
  }
}

describe('preserveFocusWithin', () => {
  it('restores keyboard focus to the recreated control that had it', () => {
    renderControls();
    document.getElementById('filter-profile')?.focus();
    const before = document.activeElement;

    preserveFocusWithin(container, renderControls);

    expect(document.activeElement?.id).toBe('filter-profile');
    // The control is a freshly created element, not the removed one.
    expect(document.activeElement).not.toBe(before);
    expect(container.contains(document.activeElement)).toBe(true);
  });

  it('never steals focus that was outside the container', () => {
    const outside = document.createElement('input');
    outside.id = 'outside-control';
    document.body.appendChild(outside);
    renderControls();
    outside.focus();

    preserveFocusWithin(container, renderControls);

    expect(document.activeElement?.id).toBe('outside-control');
  });

  it('leaves focus alone when the previously focused control is no longer rendered', () => {
    renderControls();
    document.getElementById('filter-site')?.focus();

    preserveFocusWithin(container, () => {
      container.innerHTML = '';
    });

    expect(document.activeElement).toBe(document.body);
  });
});
