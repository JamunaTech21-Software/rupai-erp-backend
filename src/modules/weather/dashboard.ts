import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import {
  MONTHS,
  RAINY_MM,
  conditionLabel,
  dailySeries,
  daysInMonth,
  monthStats,
  one,
  readDate,
  readScope,
  totalUpTo,
} from './stats.js';

/**
 * RP1-223 W.4 Weather Dashboard (`/weather-dashboard`, `images/4.jpeg`): `GET /weather/dashboard?estate=&station=
 * &date=`. Read only, from submitted entries; `date` (default today, Bangladesh) sets "today", its month and its
 * year. Weather Alerts has no source yet, so it is always "No Active Alert" (decision 2026-11-22).
 */
export const weatherDashboardRouter = Router();

const STATION_TYPES: Record<string, string> = { MANUAL: 'Manual', IOT: 'IoT (Automatic)', API: 'API' };

weatherDashboardRouter.get('/dashboard', async (req, res) => {
  const scope = await readScope(req.query);
  const date = readDate(req.query.date);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const monthKey = date.slice(0, 7);
  // Four years for the yearly comparison; the current and previous year cover everything else.
  const series = await dailySeries(scope, `${year - 3}-01-01`, date);
  const today = series.get(date) ?? null;
  // Today's Weather: today's values, or the latest day with an entry before it (its date is given).
  const latest = today ?? [...series.values()].filter((d) => d.date <= date).at(-1) ?? null;
  const monthDays = [...series.values()].filter((d) => d.date.startsWith(monthKey));

  const length = daysInMonth(year, month);
  const dayList = Array.from({ length }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`);

  const stations = await db.weatherStation.findMany({
    where: { estate: scope.estate, deletedAt: null },
    orderBy: [{ stationCode: 'asc' }],
    select: { id: true, stationCode: true, stationName: true, location: true, entryType: true, status: true },
  });

  res.json({
    estate: scope.estate,
    estateName: scope.estateName,
    station: scope.station,
    stationName: scope.stationName,
    date,
    cards: {
      todaysRainfall: today ? today.rainfall : null,
      monthlyRainfall: totalUpTo(series, `${monthKey}-01`, date),
      monthLabel: `${MONTHS[month - 1]} ${year}`,
      annualRainfall: totalUpTo(series, `${year}-01-01`, date),
      year,
      avgTemperatureToday: today ? today.avgTemperature : null,
      rainyDaysThisMonth: monthDays.filter((d) => d.rainfall >= RAINY_MM).length,
      weatherAlerts: { count: 0, label: 'No Active Alert' },
    },
    dailyRainfallTrend: dayList.map((d) => ({
      date: d,
      day: Number(d.slice(8)),
      rainfall: series.get(d)?.rainfall ?? null,
    })),
    temperatureTrend: dayList.map((d) => ({
      date: d,
      day: Number(d.slice(8)),
      maxTemperature: series.get(d)?.maxTemperature ?? null,
      minTemperature: series.get(d)?.minTemperature ?? null,
    })),
    monthlyRainfallComparison: MONTHS.map((label, i) => ({
      month: i + 1,
      label,
      currentYear: monthStats(series, year, i + 1, date).totalRainfall,
      previousYear: monthStats(series, year - 1, i + 1, date).totalRainfall,
    })),
    currentYear: year,
    previousYear: year - 1,
    yearlyRainfallComparison: [year - 3, year - 2, year - 1, year].map((y) => ({
      year: y,
      rainfall: totalUpTo(series, `${y}-01-01`, y === year ? date : `${y}-12-31`),
      upToDate: y === year,
    })),
    todaysWeather: latest
      ? {
          date: latest.date,
          isToday: latest.date === date,
          weatherCondition: latest.weatherCondition,
          weatherConditionLabel: conditionLabel(latest.weatherCondition),
          avgTemperature: latest.avgTemperature,
          rainfall: latest.rainfall,
          maxTemperature: latest.maxTemperature,
          minTemperature: latest.minTemperature,
          humidity: latest.humidity,
          windSpeed: latest.windSpeed,
          windDirection: latest.windDirection,
          sunshineHours: latest.sunshineHours,
        }
      : null,
    monthlyRainfallSummary: MONTHS.slice(0, month).map((_, i) => {
      const m = monthStats(series, year, i + 1, date);
      return {
        month: m.month,
        label: m.label,
        totalRainfall: m.totalRainfall,
        rainyDays: m.rainyDays,
        avgDailyRainfall: m.avgDailyRainfall,
        highestDailyRainfall: m.highestDailyRainfall ? one(m.highestDailyRainfall.value) : null,
        isCurrent: i + 1 === month,
      };
    }),
    weatherStations: stations.slice(0, 4).map((s, i) => ({
      sl: i + 1,
      id: s.id,
      stationCode: s.stationCode,
      stationName: s.stationName,
      location: s.location,
      entryType: s.entryType,
      entryTypeLabel: STATION_TYPES[s.entryType] ?? s.entryType,
      status: s.status,
      statusLabel: s.status === 'active' ? 'Active' : 'Inactive',
    })),
    totalStations: stations.length,
  });
});

docsPaths['/weather/dashboard'] = {
  get: {
    tags: ['Weather'],
    summary:
      "Weather Dashboard for ?estate=<id>[&station=<id>][&date=YYYY-MM-DD]: cards, daily rainfall and temperature trends, monthly and yearly comparisons, today's weather, monthly summary, stations",
    responses: {
      '200': { description: 'dashboard' },
      '400': { description: 'estate missing / station not in estate' },
    },
  },
};
