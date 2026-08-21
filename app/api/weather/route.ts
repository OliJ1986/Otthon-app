import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";
import { getSessionUser, sameOrigin } from "@/lib/auth";

const TATABANYA = {
  name: "Tatabánya",
  country: "Magyarország",
  admin1: "Komárom-Esztergom",
  latitude: 47.58494,
  longitude: 18.39325,
  timezone: "Europe/Budapest",
};

type WeatherLocation = typeof TATABANYA;

type WeatherSettingRow = {
  name: string;
  country: string;
  admin1: string | null;
  latitude: string;
  longitude: string;
  timezone: string;
};

type GeocodingResponse = {
  results?: Array<{
    name?: string;
    country?: string;
    admin1?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  }>;
};

type ForecastResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
};

function unauthorized() {
  return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
}

function validLocation(value: unknown): value is WeatherLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Record<string, unknown>;
  return typeof location.name === "string" && location.name.trim().length >= 2 && location.name.length <= 100
    && typeof location.country === "string" && location.country.length <= 100
    && (location.admin1 == null || typeof location.admin1 === "string")
    && typeof location.latitude === "number" && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90
    && typeof location.longitude === "number" && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180
    && typeof location.timezone === "string" && location.timezone.length <= 100;
}

async function selectedLocation(): Promise<WeatherLocation> {
  const rows = await getSql()`
    SELECT city_name AS name, country_name AS country, admin_area AS admin1,
      latitude::text AS latitude, longitude::text AS longitude, timezone
    FROM weather_settings WHERE id = 1 LIMIT 1
  ` as unknown as WeatherSettingRow[];
  const row = rows[0];
  return row ? {
    name: row.name,
    country: row.country,
    admin1: row.admin1 || "",
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    timezone: row.timezone,
  } : TATABANYA;
}

async function citySearch(query: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: query, count: "8", language: "hu", format: "json" }).toString();
  const response = await fetch(url, { headers: { accept: "application/json" }, next: { revalidate: 86_400 } });
  if (!response.ok) throw new Error(`Geocoding API: ${response.status}`);
  const data = await response.json() as GeocodingResponse;
  return (data.results || []).flatMap((result) => {
    if (!result.name || !Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) return [];
    return [{
      name: result.name,
      country: result.country || "",
      admin1: result.admin1 || "",
      latitude: Number(result.latitude),
      longitude: Number(result.longitude),
      timezone: result.timezone || "auto",
    }];
  });
}

async function forecast(location: WeatherLocation) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: location.timezone || "auto",
    forecast_days: "7",
  }).toString();
  const response = await fetch(url, { headers: { accept: "application/json" }, next: { revalidate: 1_800 } });
  if (!response.ok) throw new Error(`Forecast API: ${response.status}`);
  const data = await response.json() as ForecastResponse;
  const current = data.current;
  const daily = data.daily;
  if (!current || !daily?.time) throw new Error("Hiányos időjárási válasz.");

  return {
    location,
    current: {
      time: current.time || new Date().toISOString(),
      temperature: Number(current.temperature_2m),
      apparentTemperature: Number(current.apparent_temperature),
      isDay: current.is_day !== 0,
      weatherCode: Number(current.weather_code),
      windSpeed: Number(current.wind_speed_10m),
    },
    daily: daily.time.map((date, index) => ({
      date,
      weatherCode: Number(daily.weather_code?.[index]),
      temperatureMax: Number(daily.temperature_2m_max?.[index]),
      temperatureMin: Number(daily.temperature_2m_min?.[index]),
      precipitationProbability: Number(daily.precipitation_probability_max?.[index] || 0),
    })),
    refreshedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  if (!await getSessionUser(request)) return unauthorized();
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() || "";
    if (query) {
      if (query.length < 2 || query.length > 80) {
        return NextResponse.json({ error: "A város neve 2–80 karakteres lehet." }, { status: 400 });
      }
      return NextResponse.json({ locations: await citySearch(query) });
    }
    return NextResponse.json(await forecast(await selectedLocation()));
  } catch (error) {
    console.error("Weather read failed", error);
    return NextResponse.json({ error: "Az időjárás most nem tölthető be." }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const payload = await request.json().catch(() => null) as { location?: unknown } | null;
  if (!validLocation(payload?.location)) {
    return NextResponse.json({ error: "Érvénytelen város." }, { status: 400 });
  }
  const location = {
    name: payload.location.name.trim(),
    country: payload.location.country.trim(),
    admin1: payload.location.admin1?.trim() || "",
    latitude: payload.location.latitude,
    longitude: payload.location.longitude,
    timezone: payload.location.timezone.trim() || "auto",
  };

  try {
    await getSql()`
      INSERT INTO weather_settings
        (id, city_name, country_name, admin_area, latitude, longitude, timezone, updated_by, updated_at)
      VALUES (1, ${location.name}, ${location.country}, ${location.admin1 || null},
        ${location.latitude}, ${location.longitude}, ${location.timezone}, ${actor.id}, now())
      ON CONFLICT (id) DO UPDATE SET
        city_name = EXCLUDED.city_name, country_name = EXCLUDED.country_name,
        admin_area = EXCLUDED.admin_area, latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude, timezone = EXCLUDED.timezone,
        updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
    return NextResponse.json(await forecast(location));
  } catch (error) {
    console.error("Weather update failed", error);
    return NextResponse.json({ error: "A város mentése nem sikerült." }, { status: 500 });
  }
}
