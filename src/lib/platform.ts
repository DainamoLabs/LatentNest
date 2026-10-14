import { browser } from 'wxt/browser';

// Firefox's sidebar API isn't in the Chrome-derived typings.
interface SidebarAction {
  open(): Promise<void>;
  toggle(): Promise<void>;
}
const sidebarAction = () => (browser as unknown as { sidebarAction?: SidebarAction }).sidebarAction;

/** Must run synchronously inside a user-gesture handler, before any await. */
export function openSidePanel(windowId?: number): Promise<void> | undefined {
  if (import.meta.env.FIREFOX) return sidebarAction()?.open();
  if (windowId !== undefined) return browser.sidePanel.open({ windowId });
}

export function toggleSidebar() {
  return sidebarAction()?.toggle();
}

/** Whether the browser's shortcut settings can be opened for the user (Firefox 137+ or Chrome). */
export function canOpenShortcutSettings(): boolean {
  if (!import.meta.env.FIREFOX) return true;
  return typeof (browser.commands as unknown as { openShortcutSettings?: unknown }).openShortcutSettings === 'function';
}

export async function openShortcutSettings() {
  if (import.meta.env.FIREFOX) {
    await (browser.commands as unknown as { openShortcutSettings(): Promise<void> }).openShortcutSettings();
  } else {
    await browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  }
}

const ALL_SITES = { origins: ['<all_urls>'] };
export const hasSiteAccess = () => browser.permissions.contains(ALL_SITES);
export const requestSiteAccess = () => browser.permissions.request(ALL_SITES);
