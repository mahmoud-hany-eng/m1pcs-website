/**
 * Behaviour for the small dropdowns built on <details data-menu> (the Orders page's Sort and Filter): a press outside an open one closes it, Escape closes
 * it and puts focus back on its button, and opening one closes the others (the `name` attribute does that natively in current browsers; this covers the rest).
 *
 * Plain DOM, no React and no imports, so it is tested by running it in a real browser page (supabase/tests/orders.layout.browser.test.mjs). Without it the
 * menus still open and close with their button: this only adds the shortcuts people expect.
 */
export function attachMenuDismiss(doc: Document): () => void {
  const openMenus = (): HTMLDetailsElement[] => Array.from(doc.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]"));

  const onPointerDown = (event: Event): void => {
    const target = event.target as Node | null;
    for (const menu of openMenus()) if (!target || !menu.contains(target)) menu.open = false;
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    const open = openMenus();
    if (open.length === 0) return;
    for (const menu of open) menu.open = false;
    open[0].querySelector<HTMLElement>("summary")?.focus();
  };
  const onToggle = (event: Event): void => {
    const target = event.target as HTMLDetailsElement | null;
    if (!target || !target.matches?.("details[data-menu]") || !target.open) return;
    for (const menu of openMenus()) if (menu !== target) menu.open = false;
  };

  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("keydown", onKeyDown);
  doc.addEventListener("toggle", onToggle, true);
  return () => {
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("keydown", onKeyDown);
    doc.removeEventListener("toggle", onToggle, true);
  };
}
