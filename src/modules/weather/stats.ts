import { db } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { COUNTED, WEATHER_CONDITIONS, dayOf, labelOf, todayDhaka } from './entries.js';

/**
 * RP1-223 shared numbers for the weather dashboard and reports (W.4 to W.7). Only submitted entries count. With
 * no station picked, each day is the average of the estate's stations that reported that day (decision
 * 2026-11-22). A rainy day has 0.1 mm or more. A month's daily average is its total / its days (the days so far
 * for the running month).
 */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const RAINY_MM = 0.1;

export interface Day {
  date: string;
  rainfall: number;
  maxTemperature: number;
  minTemperature: number;
  avgTemperature: number;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: string | null;
  sunshineHours: number | null;
  weatherCondition: string;
}

export const one = (v: number) => Math.round(v * 10) / 10;
export const two = (v: number) => Math.round(v * 100) / 100;
const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
/** The most common value (ties: the first seen). */
const mostCommon = <T>(list: T[]) => {
  const counts = new Map<T, number>();
  for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const conditionLabel = (v: string | null) => labelOf(WEATHER_CONDITIONS, v);

/** Daily values from `from` to `to` (YYYY-MM-DD, inclusive), by date; days without a submitted entry are missing. */
export async function dailySeries(
  scope: { estate: string; station: string | null },
  from: string,
  to: string,
): Promise<Map<string, Day>> {
  const rows = await db.weatherEntry.findMany({
    where: {
      ...COUNTED,
      estate: scope.estate,
      ...(scope.station ? { station: scope.station } : {}),
      entryDate: { gte: new Date(from), lte: new Date(to) },
    },
    select: {
      entryDate: true,
      totalRainfall: true,
      maxTemperature: true,
      minTemperature: true,
      avgTemperature: true,
      avgHumidity: true,
      windSpeed: true,
      windDirection: true,
      sunshineHours: true,
      weatherCondition: true,
    },
    orderBy: { entryDate: 'asc' },
  });
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const d = dayOf(r.entryDate);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const out = new Map<string, Day>();
  for (const [date, list] of byDay) {
    const pick = (key: keyof (typeof list)[number]) =>
      list.map((r) => num(r[key])).filter((v): v is number => v !== null);
    const nullable = (key: keyof (typeof list)[number]) => {
      const a = avg(pick(key));
      return a === null ? null : one(a);
    };
    out.set(date, {
      date,
      rainfall: one(avg(pick('totalRainfall')) ?? 0),
      maxTemperature: one(avg(pick('maxTemperature')) ?? 0),
      minTemperature: one(avg(pick('minTemperature')) ?? 0),
      avgTemperature: one(avg(pick('avgTemperature')) ?? 0),
      humidity: nullable('avgHumidity'),
      windSpeed: nullable('windSpeed'),
      windDirection: mostCommon(list.map((r) => r.windDirection).filter((v): v is string => v !== null)),
      sunshineHours: nullable('sunshineHours'),
      weatherCondition: mostCommon(list.map((r) => r.weatherCondition)) ?? 'SUNNY',
    });
  }
  return out;
}

/** Totals for one calendar month of a series; `upTo` (YYYY-MM-DD) cuts off a running month. */
export function monthStats(series: Map<string, Day>, year: number, month: number, upTo: string) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const days = [...series.values()].filter((d) => d.date.startsWith(prefix) && d.date <= upTo);
  const started = `${prefix}-01` <= upTo;
  const length = !started
    ? 0
    : upTo.startsWith(prefix)
      ? Number(upTo.slice(8, 10))
      : daysInMonth(year, month);
  const total = one(days.reduce((a, d) => a + d.rainfall, 0));
  const rainy = days.filter((d) => d.rainfall >= RAINY_MM).length;
  const highest = days.reduce<Day | null>((top, d) => (!top || d.rainfall > top.rainfall ? d : top), null);
  const lowest = days.reduce<Day | null>((low, d) => (!low || d.rainfall < low.rainfall ? d : low), null);
  return {
    month,
    label: MONTHS[month - 1] ?? '',
    started,
    daysWithData: days.length,
    totalRainfall: started ? total : null,
    rainyDays: started ? rainy : null,
    avgDailyRainfall: started && length ? two(total / length) : null,
    highestDailyRainfall: highest ? { value: highest.rainfall, date: highest.date } : null,
    lowestDailyRainfall: lowest ? { value: lowest.rainfall, date: lowest.date } : null,
  };
}

/** Rainfall total of a whole series up to a date. */
export const totalUpTo = (series: Map<string, Day>, from: string, upTo: string) =>
  one(
    [...series.values()].filter((d) => d.date >= from && d.date <= upTo).reduce((a, d) => a + d.rainfall, 0),
  );

/** The page's filters: estate (required), station (optional, must be in the estate). */
export async function readScope(query: Record<string, unknown>) {
  const estate = typeof query.estate === 'string' ? query.estate : '';
  const station = typeof query.station === 'string' && query.station !== '' ? query.station : null;
  const fields: Record<string, string> = {};
  const estateRow = estate ? await db.estate.findFirst({ where: { id: estate, deletedAt: null } }) : null;
  if (!estateRow) fields.estate = 'Select an estate.';
  const stationRow = station
    ? await db.weatherStation.findFirst({ where: { id: station, deletedAt: null } })
    : null;
  if (station && (!stationRow || (estateRow && stationRow.estate !== estateRow.id)))
    fields.station = 'Select a station of this estate.';
  if (Object.keys(fields).length || !estateRow)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', fields);
  return {
    estate: estateRow.id,
    estateName: estateRow.estateName,
    station: stationRow?.id ?? null,
    stationName: stationRow?.stationName ?? null,
  };
}

/** A YYYY-MM-DD query value, else today (Bangladesh); never later than today. */
export function readDate(value: unknown, key = 'date') {
  const today = todayDhaka();
  if (value === undefined || value === '') return today;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(new Date(value).getTime())
  )
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      [key]: 'Use a date like 2026-10-16.',
    });
  return value > today ? today : value;
}

/** A YYYY-MM query value, else `fallback`; never later than this month. */
export function readMonth(value: unknown, key: string, fallback: string) {
  const now = todayDhaka().slice(0, 7);
  if (value === undefined || value === '') return fallback > now ? now : fallback;
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      [key]: 'Use a month like 2026-10.',
    });
  return value > now ? now : value;
}

/** The month before or after `month` (YYYY-MM). */
export function shiftMonth(month: string, by: number) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** "October 2026" / "Oct 2026". */
export const monthLabel = (month: string, short = false) =>
  `${(short ? MONTHS : MONTH_NAMES)[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`;

/** "22 October 2026" / "22 Oct". */
export const dayLabel = (date: string, withYear = true) =>
  `${Number(date.slice(8, 10))} ${(withYear ? MONTH_NAMES : MONTHS)[Number(date.slice(5, 7)) - 1] ?? ''}${withYear ? ` ${date.slice(0, 4)}` : ''}`;

/** The last day of a month that counts: its end, or today for the running month. */
export const monthEnd = (month: string) => {
  const today = todayDhaka();
  const end = `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, '0')}`;
  return end > today ? today : end;
};

/** A year query value, else `fallback`; never later than this year. */
export function readYear(value: unknown, key: string, fallback: number) {
  const now = Number(todayDhaka().slice(0, 4));
  if (value === undefined || value === '') return Math.min(fallback, now);
  const y = typeof value === 'string' && /^\d{4}$/.test(value) ? Number(value) : NaN;
  if (Number.isNaN(y) || y < 2000)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      [key]: 'Use a year like 2026.',
    });
  return Math.min(y, now);
}

/** Days of a year that count: all of it, or up to today for this year. */
export const yearDays = (year: number) => {
  const today = todayDhaka();
  if (Number(today.slice(0, 4)) !== year)
    return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
  return Math.round((new Date(today).getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
};
