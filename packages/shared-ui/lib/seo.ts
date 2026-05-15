import type { SiteMeta } from './types.js';

export type PageSeo = {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
};

export function buildPageSeo(meta: SiteMeta, overrides?: Partial<PageSeo>): PageSeo {
  const title = overrides?.title ?? `${meta.brandName} — ${meta.tagline}`;
  return {
    title: title.length > 60 ? title.slice(0, 57) + '…' : title,
    description: overrides?.description ?? meta.description,
    canonical: overrides?.canonical ?? meta.siteUrl,
    ogImage: overrides?.ogImage ?? meta.ogImage,
  };
}
