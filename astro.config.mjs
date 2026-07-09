import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://ministeriomana.org',
  output: 'server',
  adapter: vercel(),
  integrations: [sitemap()],
  experimental: { clientPrerender: true },
  vite: {
    build: {
      assetsInlineLimit: 0
    },
    resolve: {
      alias: {
        '@components': '/src/components',
        '@layouts': '/src/layouts',
        '@data': '/src/data',
        '@i18n': '/src/i18n',
        '@lib': '/src/lib'
      }
    }
  }
});
