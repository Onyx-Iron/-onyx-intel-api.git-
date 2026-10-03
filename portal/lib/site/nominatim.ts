/** Free geocoding via OpenStreetMap Nominatim — fair-use: identify with User-Agent. */

export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
}

export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "OnyxIntel/1.0 (construction hub; contact@onyx-iron.com)",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
  const hit = data[0];
  if (!hit) return null;
  return {
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    displayName: hit.display_name,
  };
}
