// app/pwa.config.ts
import type { VitePWAOptions } from 'vite-plugin-pwa'

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  includeAssets: ['icons/apple-touch-icon.png', 'splash/*.png'],
  manifest: {
    name: 'PPP',
    short_name: 'PPP',
    description: 'Private cycle, fertility, pregnancy and perimenopause companion. Your data stays in your browser.',
    display: 'standalone',
    id: '/',
    scope: '/',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    lang: 'en',
    categories: ['health', 'lifestyle'],
    prefer_related_applications: false,
    shortcuts: [
      { name: 'Log today', short_name: 'Log', url: '/?action=log', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Records', short_name: 'Records', url: '/?tab=records', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
    start_url: '/',
    background_color: '#FFF7F8',
    theme_color: '#FFF7F8',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    navigateFallbackDenylist: [/^\/(?:api|v1)\//],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.hostname === 'api.finchnode.com',
        handler: 'NetworkOnly',
      },
      {
        // Any cross-origin request (relay, AI provider, backup) is network-only.
        urlPattern: ({ url }) => url.origin !== self.location.origin,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: ({ url }) => url.origin === self.location.origin && /^\/(?:api|v1)\//.test(url.pathname),
        handler: 'NetworkOnly',
      },
    ],
  },
}
