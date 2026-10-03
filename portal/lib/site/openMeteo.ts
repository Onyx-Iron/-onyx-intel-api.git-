export interface WeatherDay {
  date: string;
  weatherCode: number;
  precipMm: number;
  tempMaxC: number;
  tempMinC: number;
  /** Simple risk flag for construction schedule impact. */
  delayRisk: boolean;
}

export async function fetchSiteForecast(
  lat: number,
  lon: number,
  days = 7,
): Promise<WeatherDay[]> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("daily", "weathercode,precipitation_sum,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("forecast_days", String(Math.min(16, Math.max(1, days))));
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json() as {
    daily?: {
      time: string[];
      weathercode: number[];
      precipitation_sum: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
    };
  };
  const d = data.daily;
  if (!d) return [];
  return d.time.map((date, i) => {
    const precip = d.precipitation_sum[i] ?? 0;
    const code = d.weathercode[i] ?? 0;
    return {
      date,
      weatherCode: code,
      precipMm: precip,
      tempMaxC: d.temperature_2m_max[i] ?? 0,
      tempMinC: d.temperature_2m_min[i] ?? 0,
      delayRisk: precip >= 5 || code >= 80,
    };
  });
}
