import { Router } from 'express';

import { config } from '../../config/env.js';
import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { MONTHS, conditionLabel, one, readScope } from './stats.js';

/**
 * RP1-235 W.8 Weather Forecast (`/weather-forecast`, `images/3.png`):
 * `GET /weather/forecast?estate=&station=&days=3|7[&refresh=1]`. The backend asks Open-Meteo (free, no key; the
 * only outside call, decision 2026-11-22) with the station's latitude / longitude and timezone and keeps the answer
 * for an hour per station (`refresh=1` skips it). No station picked = the estate's first Active station. Open-Meteo not answering = 503 "Forecast is not available right now.". WMO weather codes map to the
 * Daily Weather Entry conditions; wind degrees to N / NE / ... .
 */
export const weatherForecastRouter = Router();

const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const HOURS = [9, 11, 13, 15, 17, 19, 21];
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LIKELY_RAIN = 50;

/** WMO weather code -> Daily Weather Entry condition. */
export function conditionOf(code: number | null): string {
  if (code === null) return 'CLOUDY';
  if (code <= 1) return 'SUNNY';
  if (code === 2) return 'PARTLY_CLOUDY';
  if (code === 3) return 'CLOUDY';
  if (code === 45 || code === 48) return 'FOGGY';
  if (code >= 95) return 'THUNDERSTORM';
  if ([65, 67, 75, 82, 86].includes(code)) return 'HEAVY_RAIN';
  if ([63, 66, 73, 81, 85].includes(code)) return 'MODERATE_RAIN';
  return 'LIGHT_RAIN'; // drizzle 51-57, slight rain 61 / 80, light snow 71 / 77
}

export const directionOf = (deg: number | null) =>
  deg === null ? null : (DIRECTIONS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'N');

interface OpenMeteo {
  daily: Record<string, (number | string | null)[]>;
  hourly: Record<string, (number | string | null)[]>;
}
interface Cached {
  key: string;
  at: Date;
  data: OpenMeteo;
}
const cache = new Map<string, Cached>();

async function fetchForecast(lat: number, lon: number, timezone: string): Promise<OpenMeteo> {
  const url = new URL(config.FORECAST_URL);
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone,
    forecast_days: '7',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
    const body = (await res.json()) as Partial<OpenMeteo>;
    if (!Array.isArray(body.daily?.time) || !Array.isArray(body.hourly?.time))
      throw new Error('Open-Meteo answer has no daily / hourly data');
    return body as OpenMeteo;
  } catch (error) {
    logger.warn({ err: error }, 'Weather forecast: Open-Meteo call failed');
    throw new AppError('UNAVAILABLE', 'Forecast is not available right now.');
  }
}

const numAt = (list: (number | string | null)[] | undefined, i: number) => {
  const v = list?.[i];
  return typeof v === 'number' ? v : null;
};
const dayShort = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;
const dayLong = (date: string) =>
  `${DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? ''}, ${dayShort(date)}`;
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

/** "17–19 Oct", "18, 20 Oct", "31 Oct – 1 Nov": dates in order. */
export function datesLabel(dates: string[]) {
  if (!dates.length) return '';
  const consecutive = dates.every(
    (d, i) => i === 0 || new Date(d).getTime() - new Date(dates[i - 1] ?? d).getTime() === 86_400_000,
  );
  const first = dates[0] ?? '';
  const last = dates.at(-1) ?? first;
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  if (dates.length === 1) return dayShort(first);
  if (consecutive)
    return sameMonth
      ? `${Number(first.slice(8))}–${dayShort(last)}`
      : `${dayShort(first)} – ${dayShort(last)}`;
  return sameMonth
    ? `${dates.map((d) => Number(d.slice(8))).join(', ')} ${MONTHS[Number(first.slice(5, 7)) - 1] ?? ''}`
    : dates.map(dayShort).join(', ');
}

function lastUpdatedLabel(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
}

async function pickStation(query: Record<string, unknown>) {
  const scope = await readScope(query);
  const station = scope.station
    ? await db.weatherStation.findFirst({ where: { id: scope.station, deletedAt: null } })
    : await db.weatherStation.findFirst({
        where: { estate: scope.estate, deletedAt: null, status: 'active' },
        orderBy: { stationCode: 'asc' },
      });
  const problem = !station
    ? 'No Active weather station in this estate.'
    : station.status !== 'active'
      ? 'This station is Inactive.'
      : null;
  if (problem || !station)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', { station: problem ?? '' });
  return { scope, station };
}

weatherForecastRouter.get('/forecast', async (req, res) => {
  const daysValue = req.query.days === undefined || req.query.days === '' ? '7' : req.query.days;
  if (daysValue !== '3' && daysValue !== '7')
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      days: 'Pick Next 3 Days or Next 7 Days.',
    });
  const days = Number(daysValue);
  const { scope, station } = await pickStation(req.query);
  const lat = Number(station.latitude);
  const lon = Number(station.longitude);
  const timezone = station.timezone;
  const key = `${lat},${lon},${timezone}`;

  let hit = cache.get(station.id);
  const fresh =
    hit && hit.key === key && Date.now() - hit.at.getTime() < CACHE_MS && req.query.refresh !== '1';
  if (!fresh || !hit) {
    hit = { key, at: new Date(), data: await fetchForecast(lat, lon, timezone) };
    cache.set(station.id, hit);
  }
  const { daily, hourly } = hit.data;

  const forecast = (daily.time ?? []).slice(0, days).map((t, i) => {
    const date = String(t);
    const condition = conditionOf(numAt(daily.weather_code, i));
    const max = numAt(daily.temperature_2m_max, i);
    const min = numAt(daily.temperature_2m_min, i);
    const rain = numAt(daily.precipitation_sum, i);
    const wind = numAt(daily.wind_speed_10m_max, i);
    return {
      date,
      dayLabel: dayLong(date),
      label: dayShort(date),
      condition,
      conditionLabel: conditionLabel(condition),
      maxTemperature: max === null ? null : one(max),
      minTemperature: min === null ? null : one(min),
      rainChance: numAt(daily.precipitation_probability_max, i),
      rainfall: rain === null ? null : one(rain),
      windSpeed: wind === null ? null : Math.round(wind),
      windDirection: directionOf(numAt(daily.wind_direction_10m_dominant, i)),
    };
  });
  const today = forecast[0] ?? null;

  const hourlyToday = today
    ? HOURS.map((h) => {
        const i = (hourly.time ?? []).indexOf(`${today.date}T${String(h).padStart(2, '0')}:00`);
        const temp = i < 0 ? null : numAt(hourly.temperature_2m, i);
        const condition = conditionOf(i < 0 ? null : numAt(hourly.weather_code, i));
        return {
          time: `${String(h).padStart(2, '0')}:00`,
          label: hourLabel(h),
          temperature: temp === null ? null : one(temp),
          rainChance: i < 0 ? null : numAt(hourly.precipitation_probability, i),
          condition,
          conditionLabel: conditionLabel(condition),
        };
      })
    : [];

  // Forecast Highlights: rain ahead, highest and lowest temperature, total expected rainfall.
  const ahead = forecast.slice(1);
  const wet = ahead.filter((d) => (d.rainChance ?? 0) >= LIKELY_RAIN);
  const run = wet.length && wet.every((d, i) => d.date === ahead[i]?.date);
  const meanRain = wet.length ? wet.reduce((a, d) => a + (d.rainfall ?? 0), 0) / wet.length : 0;
  const intensity = meanRain < 10 ? 'light' : meanRain < 30 ? 'moderate' : 'heavy';
  const temps = (k: 'maxTemperature' | 'minTemperature') =>
    forecast.map((d) => d[k]).filter((v): v is number => v !== null);
  const hi = temps('maxTemperature').length ? Math.max(...temps('maxTemperature')) : null;
  const lo = temps('minTemperature').length ? Math.min(...temps('minTemperature')) : null;
  const total = one(forecast.reduce((a, d) => a + (d.rainfall ?? 0), 0));
  const highlights = [
    wet.length
      ? run
        ? `Rain is likely for the next ${wet.length === 1 ? 'day' : `${wet.length} days`} (${datesLabel(wet.map((d) => d.date))}) with ${intensity} intensity.`
        : `Rain is likely on ${datesLabel(wet.map((d) => d.date))} with ${intensity} intensity.`
      : `No significant rain is expected in the next ${days} days.`,
    ...(hi !== null
      ? [
          `Highest temperature expected: ${hi.toFixed(1)} °C on ${datesLabel(forecast.filter((d) => d.maxTemperature === hi).map((d) => d.date))}.`,
        ]
      : []),
    ...(lo !== null
      ? [
          `Lowest temperature expected: ${lo.toFixed(1)} °C on ${datesLabel(forecast.filter((d) => d.minTemperature === lo).map((d) => d.date))}.`,
        ]
      : []),
    `Total expected rainfall (next ${days} days): ${total.toFixed(1)} mm.`,
  ];

  res.json({
    estate: scope.estate,
    estateName: scope.estateName,
    station: station.id,
    stationCode: station.stationCode,
    stationName: station.stationName,
    latitude: lat,
    longitude: lon,
    timezone,
    days,
    lastUpdated: hit.at.toISOString(),
    lastUpdatedLabel: lastUpdatedLabel(hit.at, timezone),
    today: today
      ? {
          date: today.date,
          dateLabel: `${dayShort(today.date)} ${today.date.slice(0, 4)}`,
          condition: today.condition,
          conditionLabel: today.conditionLabel,
          maxTemperature: today.maxTemperature,
          minTemperature: today.minTemperature,
          rainChance: today.rainChance,
          rainfall: today.rainfall,
          windSpeed: today.windSpeed,
          windDirection: today.windDirection,
        }
      : null,
    forecast,
    hourly: hourlyToday,
    highlights,
    source: 'Open-Meteo',
  });
});

docsPaths['/weather/forecast'] = {
  get: {
    tags: ['Weather'],
    summary:
      "Weather Forecast for ?estate=<id>[&station=<id>][&days=3|7][&refresh=1] from Open-Meteo, kept 1 hour per station: today's forecast, days, hourly today, highlights",
    responses: {
      '200': { description: 'forecast' },
      '400': { description: 'estate / station / days wrong, or the station is Inactive' },
      '503': { description: 'Forecast is not available right now.' },
    },
  },
};
