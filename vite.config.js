import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5190 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: '80m Agent Control',
        short_name: '80m',
        description: 'Sovereign Agent Council — Mission Control Interface',
        theme_color: '#050505',
        background_color: '#eae7de',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        categories: ['productivity', 'utilities'],
        dir: 'ltr',
        lang: 'en',
        handle_links: 'preferred',
        launch_handler: { client_mode: 'navigate-existing' },
        prefer_related_applications: false,
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        edge_side_panel: { preferred_width: 400 },
        shortcuts: [
          {
            name: 'New Chat',
            short_name: 'Chat',
            description: 'Start a new conversation',
            url: '/?action=new',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Settings',
            short_name: 'Settings',
            description: 'Open settings',
            url: '/?panel=settings',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Skills Hub',
            short_name: 'Skills',
            description: 'Browse available skills',
            url: '/?panel=skills',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          // NetworkFirst for API calls — falls back to cache if network fails
          {
            urlPattern: /^http:\/\/localhost:5174\/chat/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'hermes-chat-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^http:\/\/127\.0\.0\.1:5174\/chat/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'hermes-chat-api-alt',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // NetworkFirst for Hermes FS endpoints
          {
            urlPattern: /^http:\/\/localhost:5174\/fs\//i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'hermes-fs-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^http:\/\/127\.0\.0\.1:5174\/fs\//i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'hermes-fs-api-alt',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // CacheFirst for external static assets (1 week)
          {
            urlPattern: /^https:\/\/i\.postimg\.cc\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mascot-images',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/www\.transparenttextures\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'paper-texture',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          // CacheFirst for Google Fonts (1 week)
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ],
});
