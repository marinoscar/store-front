import { env } from '../config.js';

export type GeocodeResult = {
  address: string;
  lat: number;
  lng: number;
  confidence: number;
};

/**
 * Validate and normalize a free-text address.
 * Dispatches to the configured provider via GEOCODE_PROVIDER.
 */
export async function geocode(query: string): Promise<GeocodeResult | undefined> {
  switch (env.GEOCODE_PROVIDER) {
    case 'mapbox':
      return geocodeMapbox(query);
    case 'google':
      return geocodeGoogle(query);
    case 'smarty':
      return geocodeSmarty(query);
  }
}

async function geocodeMapbox(query: string): Promise<GeocodeResult | undefined> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${encodeURIComponent(env.GEOCODE_API_KEY)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const data = (await res.json()) as {
    features?: Array<{ place_name: string; center: [number, number]; relevance: number }>;
  };
  const f = data.features?.[0];
  if (!f) return undefined;
  return {
    address: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
    confidence: f.relevance,
  };
}

async function geocodeGoogle(query: string): Promise<GeocodeResult | undefined> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(query)}&key=${encodeURIComponent(env.GEOCODE_API_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const data = (await res.json()) as {
    results?: Array<{
      formatted_address: string;
      geometry: { location: { lat: number; lng: number }; location_type: string };
    }>;
  };
  const r = data.results?.[0];
  if (!r) return undefined;
  return {
    address: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    confidence: r.geometry.location_type === 'ROOFTOP' ? 1 : 0.7,
  };
}

async function geocodeSmarty(query: string): Promise<GeocodeResult | undefined> {
  const url =
    `https://us-street.api.smarty.com/street-address?key=${encodeURIComponent(env.GEOCODE_API_KEY)}` +
    `&street=${encodeURIComponent(query)}&match=enhanced`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const data = (await res.json()) as Array<{
    delivery_line_1?: string;
    last_line?: string;
    metadata?: { latitude?: number; longitude?: number; precision?: string };
  }>;
  const r = data[0];
  if (!r || !r.metadata?.latitude || !r.metadata.longitude) return undefined;
  return {
    address: [r.delivery_line_1, r.last_line].filter(Boolean).join(', '),
    lat: r.metadata.latitude,
    lng: r.metadata.longitude,
    confidence: r.metadata.precision === 'Zip9' ? 1 : 0.8,
  };
}
