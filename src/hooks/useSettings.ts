import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { getBackend, getStyles, onSettingsChanged, type BackendSettings, type CaptionStyle } from '@/lib/settings';
import { hasSiteAccess, requestSiteAccess } from '@/lib/platform';
import { ADD_COMMAND } from '@/lib/menus';

export function useSettings() {
  const [state, setState] = useState<{ backend: BackendSettings; styles: CaptionStyle[] }>();
  useEffect(() => {
    const load = () => Promise.all([getBackend(), getStyles()]).then(([backend, styles]) => setState({ backend, styles }));
    void load();
    return onSettingsChanged(load);
  }, []);
  return state;
}

/** Whether LatentNest may download images from any site. */
export function useSiteAccess() {
  const [granted, setGranted] = useState<boolean>();
  useEffect(() => {
    const check = () => void hasSiteAccess().then(setGranted);
    check();
    browser.permissions.onAdded.addListener(check);
    browser.permissions.onRemoved.addListener(check);
    return () => {
      browser.permissions.onAdded.removeListener(check);
      browser.permissions.onRemoved.removeListener(check);
    };
  }, []);
  const request = async () => setGranted(await requestSiteAccess());
  return { granted, request };
}

/**
 * The keys for "add what's under the pointer": '' when none are set,
 * undefined while loading. They're changed on a browser page, so this checks
 * again whenever the page is shown.
 */
export function useAddShortcut() {
  const [keys, setKeys] = useState<string>();
  useEffect(() => {
    const load = () =>
      void browser.commands
        .getAll()
        .then((all) => setKeys(all.find((c) => c.name === ADD_COMMAND)?.shortcut ?? ''))
        .catch(() => setKeys(''));
    const onShow = () => document.visibilityState === 'visible' && load();
    load();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', load);
    // Firefox also says when they change.
    const changed = commandsChanged();
    changed?.addListener(load);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', load);
      changed?.removeListener(load);
    };
  }, []);
  return keys;
}

type Listeners = { addListener(fn: () => void): void; removeListener(fn: () => void): void };
const commandsChanged = () => (browser.commands as unknown as { onChanged?: Listeners }).onChanged;
