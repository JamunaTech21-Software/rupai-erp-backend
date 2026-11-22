import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { AppError } from '../../lib/errors.js';
import { type ExportColumn, exportFormat, sendExport } from '../../lib/export.js';
import { todayDhaka } from './entries.js';
import {
  type Day,
  MONTH_NAMES,
  RAINY_MM,
  dailySeries,
  dayLabel,
  monthEnd,
  monthLabel,
  monthStats,
  one,
  readMonth,
  readScope,
  shiftMonth,
  totalUpTo,
} from './stats.js';

/**
 * RP1-232 W.7 Weather Reports & Analytics (`/weather-reports`, `images/7.jpeg`):
 * `GET /weather/reports?estate=&station=&from=YYYY-MM&to=YYYY-MM&type=ALL|RAINFALL|TEMPERATURE|HUMIDITY` and the Quick
 * Reports as Excel: `GET /weather/reports/export?report=monthly-rainfall|monthly-average-rainfall|annual-weather|
 * weather-summary&...`. The period defaults to January of this year to this month (at most 24 months). Report Type
 * leaves out the sections of the other kinds (they come back null). "Rainfall vs Production Analysis" is left out:
 * there is no production data yet (decision 2026-11-22).
 */
export const weatherReportsRouter = Router();

const TYPES = ['ALL', 'RAINFALL', 'TEMPERATURE', 'HUMIDITY'] as const;
type ReportType = (typeof TYPES)[number];
const REPORTS = [
  { key: 'monthly-rainfall', label: 'Monthly Rainfall Report' },
  { key: 'monthly-average-rainfall', label: 'Monthly Average Rainfall Report' },
  { key: 'annual-weather', label: 'Annual Weather Report' },
  { key: 'weather-summary', label: 'Weather Summary Report' },
] as const;
const MAX_MONTHS = 24;

const mean = (list: number[]) => (list.length ? one(list.reduce((a, b) => a + b, 0) / list.length) : null);
const values = (
  days: Day[],
  key: 'maxTemperature' | 'minTemperature' | 'avgTemperature' | 'humidity' | 'sunshineHours' | 'windSpeed',
) => days.map((d) => d[key]).filter((v): v is number => v !== null);
const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
};

async function build(query: Record<string, unknown>) {
  const scope = await readScope(query);
  const thisMonth = todayDhaka().slice(0, 7);
  const to = readMonth(query.to, 'to', thisMonth);
  const from = readMonth(query.from, 'from', `${to.slice(0, 4)}-01`);
  const typeValue = typeof query.type === 'string' && query.type !== '' ? query.type.toUpperCase() : 'ALL';
  const fields: Record<string, string> = {};
  if (from > to) fields.from = 'The start month must not be after the end month.';
  else if (monthsBetween(from, to).length > MAX_MONTHS) fields.from = `Pick at most ${MAX_MONTHS} months.`;
  if (!(TYPES as readonly string[]).includes(typeValue)) fields.type = 'Select a report type from the list.';
  if (Object.keys(fields).length)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', fields);
  const type = typeValue as ReportType;

  const end = monthEnd(to);
  const toYear = Number(to.slice(0, 4));
  const startAll = [shiftMonth(from, -12), `${toYear - 4}-01`].sort()[0] ?? from;
  const series = await dailySeries(scope, `${startAll}-01`, end);
  const inRange = (a: string, b: string) => [...series.values()].filter((d) => d.date >= a && d.date <= b);
  const periodDays = inRange(`${from}-01`, end);
  const months = monthsBetween(from, to);

  const monthRow = (key: string) => {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7));
    const stats = monthStats(series, y, m, monthEnd(key));
    const days = inRange(`${key}-01`, monthEnd(key));
    return {
      month: key,
      label: monthLabel(key, true).split(' ')[0] ?? key,
      monthLabel: monthLabel(key, true),
      totalRainfall: stats.totalRainfall ?? 0,
      rainyDays: stats.rainyDays ?? 0,
      highestDailyRainfall: stats.highestDailyRainfall?.value ?? null,
      avgDailyRainfall: stats.avgDailyRainfall ?? 0,
      maxTemperature: mean(values(days, 'maxTemperature')),
      minTemperature: mean(values(days, 'minTemperature')),
      avgTemperature: mean(values(days, 'avgTemperature')),
      humidity: mean(values(days, 'humidity')),
      sunshineHours: mean(values(days, 'sunshineHours')),
      windSpeed: mean(values(days, 'windSpeed')),
      daysWithData: days.length,
    };
  };
  const rows = months.map(monthRow);

  const total = one(periodDays.reduce((a, d) => a + d.rainfall, 0));
  const rainyDays = periodDays.filter((d) => d.rainfall >= RAINY_MM).length;
  const hottest = periodDays.reduce<Day | null>(
    (t, d) => (!t || d.maxTemperature > t.maxTemperature ? d : t),
    null,
  );
  const coldest = periodDays.reduce<Day | null>(
    (t, d) => (!t || d.minTemperature < t.minTemperature ? d : t),
    null,
  );
  const avgTemperature = mean(values(periodDays, 'avgTemperature'));
  const avgHumidity = mean(values(periodDays, 'humidity'));

  const years = [toYear - 4, toYear - 3, toYear - 2, toYear - 1, toYear];
  const yearEnd = (y: number) => (y === toYear ? end : `${y}-12-31`);
  const annual = years.map((y) => ({
    year: y,
    rainfall: totalUpTo(series, `${y}-01-01`, yearEnd(y)),
    upToDate: y === toYear,
  }));

  // Key Insights: the same months a year earlier, the peak month, temperature and humidity.
  // A running period is compared up to the same day a year earlier (29 Feb becomes 28 Feb).
  const lastYearEnd = `${Number(end.slice(0, 4)) - 1}${end.slice(4).replace('-02-29', '-02-28')}`;
  const before = one(inRange(`${shiftMonth(from, -12)}-01`, lastYearEnd).reduce((a, d) => a + d.rainfall, 0));
  const change = before > 0 ? one(((total - before) / before) * 100) : null;
  const peak = rows.reduce<(typeof rows)[number] | null>(
    (t, r) => (!t || r.totalRainfall > t.totalRainfall ? r : t),
    null,
  );
  const periodName = from === to ? monthLabel(from) : `${monthLabel(from, true)} – ${monthLabel(to, true)}`;
  const samePeriod =
    from.slice(0, 4) === to.slice(0, 4) && from.endsWith('-01') && (to.endsWith('-12') || to === thisMonth)
      ? String(Number(from.slice(0, 4)) - 1)
      : 'the same period last year';
  const keyInsights = periodDays.length
    ? [
        change !== null
          ? `Total rainfall in ${from.endsWith('-01') && from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : periodName} is ${total.toFixed(1)} mm, which is ${Math.abs(change)}% ${change >= 0 ? 'higher' : 'lower'} than ${samePeriod} (${before.toFixed(1)} mm).`
          : `Total rainfall in ${periodName} is ${total.toFixed(1)} mm (no data for the same period a year earlier).`,
        peak && peak.totalRainfall > 0
          ? `Peak rainfall occurred in ${MONTH_NAMES[Number(peak.month.slice(5, 7)) - 1]} (${peak.totalRainfall.toFixed(1)} mm) with ${peak.rainyDays} rainy days.`
          : 'No rainfall was recorded in this period.',
        `Average temperature was ${avgTemperature !== null ? `${avgTemperature.toFixed(1)} °C` : '-'} and average humidity was ${avgHumidity !== null ? `${Math.round(avgHumidity)}%` : '-'} in ${periodName}.`,
      ]
    : [`No submitted weather entries for ${periodName}.`];

  const rain = type === 'ALL' || type === 'RAINFALL';
  const temp = type === 'ALL' || type === 'TEMPERATURE';
  const hum = type === 'ALL' || type === 'HUMIDITY';
  const point = (d: Day | null, v: (x: Day) => number) =>
    d ? { value: v(d), date: d.date, dateLabel: dayLabel(d.date) } : null;

  return {
    rows,
    annual,
    years,
    from,
    to,
    series,
    end,
    body: {
      estate: scope.estate,
      estateName: scope.estateName,
      station: scope.station,
      stationName: scope.stationName,
      from,
      to,
      upTo: end,
      periodLabel: periodName,
      type,
      cards: {
        totalRainfall: rain ? total : null,
        rainyDays: rain ? rainyDays : null,
        avgTemperature: temp ? avgTemperature : null,
        avgHumidity: hum ? avgHumidity : null,
        highestTemperature: temp ? point(hottest, (d) => d.maxTemperature) : null,
        lowestTemperature: temp ? point(coldest, (d) => d.minTemperature) : null,
      },
      monthlyRainfallTrend: rain
        ? rows.map((r) => ({ month: r.month, label: r.label, rainfall: r.totalRainfall }))
        : null,
      temperatureHumidityTrend:
        temp || hum
          ? rows.map((r) => ({
              month: r.month,
              label: r.label,
              maxTemperature: temp ? r.maxTemperature : null,
              minTemperature: temp ? r.minTemperature : null,
              humidity: hum ? r.humidity : null,
            }))
          : null,
      annualRainfallComparison: rain ? annual : null,
      monthlyAverageRainfall: rain
        ? rows.map((r) => ({ month: r.month, label: r.label, average: r.avgDailyRainfall }))
        : null,
      quickReports: REPORTS.map((r) => ({ ...r, path: `/weather/reports/export?report=${r.key}` })),
      keyInsights,
    },
  };
}

weatherReportsRouter.get('/reports', async (req, res) => {
  res.json((await build(req.query)).body);
});

const n1 = '0.0';
weatherReportsRouter.get('/reports/export', async (req, res) => {
  const format = exportFormat(req.query.format);
  const report =
    typeof req.query.report === 'string' && req.query.report !== '' ? req.query.report : 'weather-summary';
  const kind = REPORTS.find((r) => r.key === report);
  if (!kind)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      report: 'Select a report from the list.',
    });
  const { rows, annual, years, from, to, series, end } = await build({ ...req.query, type: 'ALL' });
  const period = `${from}_${to}`;
  let columns: ExportColumn[];
  let data: Record<string, unknown>[];
  if (kind.key === 'monthly-rainfall') {
    data = rows;
    columns = [
      { header: 'Month', value: (r) => r.monthLabel, width: 12 },
      { header: 'Total Rainfall (mm)', value: (r) => r.totalRainfall, width: 18, numFmt: '#,##0.0' },
      { header: 'Rainy Days', value: (r) => r.rainyDays, width: 12 },
      { header: 'Highest Daily (mm)', value: (r) => r.highestDailyRainfall, width: 18, numFmt: n1 },
      { header: 'Avg Daily (mm/day)', value: (r) => r.avgDailyRainfall, width: 18, numFmt: '0.00' },
    ];
  } else if (kind.key === 'monthly-average-rainfall') {
    data = rows;
    columns = [
      { header: 'Month', value: (r) => r.monthLabel, width: 12 },
      { header: 'Average Rainfall (mm/day)', value: (r) => r.avgDailyRainfall, width: 24, numFmt: '0.00' },
      { header: 'Total Rainfall (mm)', value: (r) => r.totalRainfall, width: 18, numFmt: '#,##0.0' },
      { header: 'Days with Entries', value: (r) => r.daysWithData, width: 16 },
    ];
  } else if (kind.key === 'annual-weather') {
    data = years.map((y) => {
      const days = [...series.values()].filter(
        (d) => d.date >= `${y}-01-01` && d.date <= (y === years.at(-1) ? end : `${y}-12-31`),
      );
      return {
        year: y,
        rainfall: annual.find((a) => a.year === y)?.rainfall ?? 0,
        rainy: days.filter((d) => d.rainfall >= RAINY_MM).length,
        avgT: mean(values(days, 'avgTemperature')),
        maxT: days.length ? Math.max(...days.map((d) => d.maxTemperature)) : null,
        minT: days.length ? Math.min(...days.map((d) => d.minTemperature)) : null,
        hum: mean(values(days, 'humidity')),
        days: days.length,
      };
    });
    columns = [
      { header: 'Year', value: (r) => r.year, width: 8 },
      { header: 'Total Rainfall (mm)', value: (r) => r.rainfall, width: 18, numFmt: '#,##0.0' },
      { header: 'Rainy Days', value: (r) => r.rainy, width: 12 },
      { header: 'Avg Temp (°C)', value: (r) => r.avgT, width: 14, numFmt: n1 },
      { header: 'Highest Temp (°C)', value: (r) => r.maxT, width: 16, numFmt: n1 },
      { header: 'Lowest Temp (°C)', value: (r) => r.minT, width: 16, numFmt: n1 },
      { header: 'Avg Humidity (%)', value: (r) => r.hum, width: 16, numFmt: n1 },
      { header: 'Days with Entries', value: (r) => r.days, width: 16 },
    ];
  } else {
    data = rows;
    columns = [
      { header: 'Month', value: (r) => r.monthLabel, width: 12 },
      { header: 'Total Rainfall (mm)', value: (r) => r.totalRainfall, width: 18, numFmt: '#,##0.0' },
      { header: 'Rainy Days', value: (r) => r.rainyDays, width: 12 },
      { header: 'Avg Daily Rainfall (mm/day)', value: (r) => r.avgDailyRainfall, width: 24, numFmt: '0.00' },
      { header: 'Avg Max Temp (°C)', value: (r) => r.maxTemperature, width: 16, numFmt: n1 },
      { header: 'Avg Min Temp (°C)', value: (r) => r.minTemperature, width: 16, numFmt: n1 },
      { header: 'Avg Temp (°C)', value: (r) => r.avgTemperature, width: 14, numFmt: n1 },
      { header: 'Avg Humidity (%)', value: (r) => r.humidity, width: 16, numFmt: n1 },
      { header: 'Avg Sunshine (h)', value: (r) => r.sunshineHours, width: 16, numFmt: n1 },
      { header: 'Avg Wind (km/h)', value: (r) => r.windSpeed, width: 16, numFmt: n1 },
    ];
  }
  await sendExport(res, format, {
    fileName: `weather-${kind.key}-${kind.key === 'annual-weather' ? `${years[0]}-${years.at(-1)}` : period}`,
    sheet: kind.label.slice(0, 31),
    rows: data,
    columns,
  });
});

docsPaths['/weather/reports'] = {
  get: {
    tags: ['Weather'],
    summary:
      'Weather Reports & Analytics for ?estate=<id>[&station=<id>][&from=YYYY-MM][&to=YYYY-MM][&type=ALL|RAINFALL|TEMPERATURE|HUMIDITY]: cards, four charts, quick reports, key insights',
    responses: {
      '200': { description: 'report' },
      '400': { description: 'estate / station / period / type wrong' },
    },
  },
};
docsPaths['/weather/reports/export'] = {
  get: {
    tags: ['Weather'],
    summary:
      'A Quick Report as xlsx (default) or csv: ?report=monthly-rainfall|monthly-average-rainfall|annual-weather|weather-summary plus the report query',
    responses: { '200': { description: 'file' }, '400': { description: 'report / query wrong' } },
  },
};
