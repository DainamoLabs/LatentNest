// Runs in web pages (registered for every site once website access is
// granted, or injected on demand). It notes where the last right-click was,
// so "Add to Dataset" can find a picture the site covers with an overlay,
// and where the pointer is, for the keyboard shortcut. It only remembers
// positions; nothing leaves the page until the menu or shortcut is used.
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { findMedia, type FinderGlobal } from '@/lib/findImage';

export default defineUnlistedScript(() => {
  const g = globalThis as typeof globalThis & FinderGlobal;
  // Injected again after an extension update: keep the one listener, replace the finder.
  if (!g.__latentnestPointerHook) {
    g.__latentnestPointerHook = true;
    addEventListener(
      'contextmenu',
      (e) => {
        g.__latentnestPointer = { x: e.clientX, y: e.clientY, at: Date.now() };
      },
      { capture: true, passive: true },
    );
  }
  // For the keyboard shortcut: where the pointer is. Only the position is kept.
  if (!g.__latentnestHoverHook) {
    g.__latentnestHoverHook = true;
    addEventListener(
      'pointermove',
      (e) => {
        g.__latentnestHover = { x: e.clientX, y: e.clientY, at: Date.now() };
      },
      { capture: true, passive: true },
    );
  }
  g.__latentnestFind = (request) => findMedia(request, request.pointer === 'hover' ? g.__latentnestHover : g.__latentnestPointer);
});
