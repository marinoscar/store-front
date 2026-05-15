import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

const SITE_URL = process.env.SITE_URL ?? 'https://raul2.dev.marin.cr';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'never',
  integrations: [react(), sitemap()],
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    ssr: {
      noExternal: ['@store-front/shared-ui'],
    },
  },
});
