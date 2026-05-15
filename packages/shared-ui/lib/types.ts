/** Shapes for per-site content JSON files. Matches sites/*/src/content/*.json. */

export type SiteMeta = {
  brandName: string;
  tagline: string;
  description: string;
  phone: string;
  phoneE164: string;
  email: string;
  address: {
    street?: string;
    city: string;
    region: string;
    postal?: string;
    country: string;
    lat?: number;
    lng?: number;
  };
  areaServed: string[];
  siteUrl: string;
  ogImage: string;
  socials?: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
  };
  yearsInBusiness?: number;
  certifications?: string[];
};

export type Service = {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  image: string;
  highlights?: string[];
};

export type Review = {
  author: string;
  text: string;
  rating: number;
  date?: string;
  location?: string;
};

export type FaqItem = {
  q: string;
  a: string;
};

export type ProcessStep = {
  step: number;
  title: string;
  description: string;
  icon?: string;
};

export type BeforeAfterPair = {
  before: string;
  after: string;
  caption: string;
};

export type CrewPhoto = {
  src: string;
  alt: string;
  name?: string;
  role?: string;
};
