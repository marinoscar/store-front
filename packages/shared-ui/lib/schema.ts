import type { FaqItem, Review, Service, SiteMeta } from './types.js';

/** Build a JSON-LD LocalBusiness object for the site. */
export function localBusinessSchema(meta: SiteMeta, reviews?: Review[]): Record<string, unknown> {
  const aggregate =
    reviews && reviews.length > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: (
              reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
            ).toFixed(1),
            reviewCount: reviews.length,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {};

  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: meta.brandName,
    description: meta.description,
    telephone: meta.phoneE164,
    email: meta.email,
    url: meta.siteUrl,
    image: new URL(meta.ogImage, meta.siteUrl).toString(),
    address: {
      '@type': 'PostalAddress',
      streetAddress: meta.address.street,
      addressLocality: meta.address.city,
      addressRegion: meta.address.region,
      postalCode: meta.address.postal,
      addressCountry: meta.address.country,
    },
    geo:
      meta.address.lat && meta.address.lng
        ? {
            '@type': 'GeoCoordinates',
            latitude: meta.address.lat,
            longitude: meta.address.lng,
          }
        : undefined,
    areaServed: meta.areaServed.map((name) => ({ '@type': 'City', name })),
    sameAs: [meta.socials?.facebook, meta.socials?.instagram, meta.socials?.twitter].filter(
      Boolean,
    ),
    ...aggregate,
  };
}

export function faqPageSchema(faqs: FaqItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function servicesSchema(services: Service[], meta: SiteMeta): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: services.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Service',
        name: s.name,
        description: s.shortDescription,
        provider: { '@type': 'LocalBusiness', name: meta.brandName },
      },
    })),
  };
}
