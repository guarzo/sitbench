// ---------------------------------------------------------------------------
// Focus preservation across re-renders
// ---------------------------------------------------------------------------

/**
 * Runs `render`, which is free to replace every child of `container`, while
 * preserving the user's keyboard focus across the rebuild.
 *
 * Focus is only ever captured when the currently focused element lives
 * inside `container` and carries an `id`; it is then restored to whichever
 * element `render` produced with that same `id`. If focus was somewhere else
 * on the page, or the previously focused control is no longer rendered,
 * focus is left exactly where the browser put it — this helper never steals
 * focus, it only gives back focus the re-render itself took away.
 *
 * Selection and caret state are deliberately not restored: the controls this
 * guards are `<select>` and `<input type="date">` elements, whose value is
 * re-applied by the render itself.
 */
export function preserveFocusWithin(container: HTMLElement, render: () => void): void {
  const active = container.ownerDocument.activeElement;
  const focusedId = active !== null && container.contains(active) ? active.id : '';

  render();

  if (focusedId === '') {
    return;
  }
  const restored = container.ownerDocument.getElementById(focusedId);
  if (restored !== null && container.contains(restored)) {
    restored.focus();
  }
}
