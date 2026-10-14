import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  // Firefox defaults to MV2 in WXT; we target MV3 everywhere.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'LatentNest',
    description: 'Collect images from the web into captioned training datasets.',
    permissions: [
      'contextMenus',
      'storage',
      'unlimitedStorage',
      'scripting',
      'activeTab',
      // "Auto-captioning finished", for long runs.
      'notifications',
      // Chrome runs batch captioning in an offscreen document; Firefox in its event page.
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    // Requested at runtime from the side panel so the store listing doesn't
    // demand access to every site up front.
    optional_host_permissions: ['<all_urls>'],
    // Local LLM servers. Granted at install; these are loopback-only.
    host_permissions: [
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
    action: {
      default_title: 'LatentNest',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    // For sites that replace the right-click menu (TikTok, YouTube). Id: ADD_COMMAND in src/lib/menus.ts.
    commands: {
      'add-under-pointer': {
        suggested_key: { default: 'Alt+Q' },
        description: 'Add the picture or video frame under the pointer to the last used dataset',
      },
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'latentnest@dainamolabs',
          strict_min_version: '128.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
