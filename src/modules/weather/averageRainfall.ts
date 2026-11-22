import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { exportFormat, sendExport } from '../../lib/export.js';
import { todayDhaka } from './entries.js';
import {
  MONTHS,
  MONTH_NAMES,
  RAINY_MM,
  dailySeries,
  monthStats,
  one,
  readScope,
  readYear,
  totalUpTo,
  two,
  yearDays,
} from './stats.js';

/**
 * RP1-229 W.6 Monthly Average Rainfall (`/weather-monthly-average-rainfall`, `images/1.png`):
 * `GET /weather/monthly-average-rainfall?estate=&station=&year=&compare=` and its Excel export. A month's average is
 * its total / its days (days so far for the running month); Annual Average is the year's total / its days (so far);
 * Months with Rain have an average of 0.1 mm/day or more. Year defaults to this year, Compare With to the year
 * before. The first card is the current month of this year (the highlighted row), or December of a past year.
 */
export const weatherAverageRainfallRouter = Router();

const pct = (a: number, b: number) => (b > 0 ? one(((a - b) / b) * 100) : null);

async function build(query: Record<string, unknown>) {
  const scope = await readScope(query);
  const thisYear = Number(todayDhaka().slice(0, 4));
  const year = readYear(query.year, 'year', thisYear);
  const compare = readYear(query.compare, 'compare', year - 1);
  const today = todayDhaka();
  const from = Math.min(year - 4, compare);
  const series = await dailySeries(scope, `${from}-01-01`, today);
  const yearEnd = (y: number) => (y === thisYear ? today : `${y}-12-31`);

  const monthsOf = (y: number) =>
    MONTHS.map((label, i) => {
      const m = monthStats(series, y, i + 1, yearEnd(y));
      return {
        month: i + 1,
        label,
        name: MONTH_NAMES[i] ?? label,
        started: m.started,
        totalRainfall: m.totalRainfall,
        rainyDays: m.rainyDays,
        avgRainfall: m.avgDailyRainfall,
      };
    });
  const annual = (y: number) => {
    const total = totalUpTo(series, `${y}-01-01`, yearEnd(y));
    return { total, average: two(total / yearDays(y)) };
  };

  const months = monthsOf(year);
  const compareMonths = monthsOf(compare);
  const started = months.filter((m) => m.started && m.avgRainfall !== null);
  const current = year === thisYear ? Number(today.slice(5, 7)) : 12;
  const currentRow = months[current - 1];
  const highest = started.reduce<(typeof started)[number] | null>(
    (top, m) => (!top || (m.avgRainfall ?? 0) > (top.avgRainfall ?? 0) ? m : top),
    null,
  );
  const lowest = started.reduce<(typeof started)[number] | null>(
    (low, m) => (!low || (m.avgRainfall ?? 0) < (low.avgRainfall ?? 0) ? m : low),
    null,
  );
  const a = annual(year);
  const c = annual(compare);
  const change = pct(a.average, c.average);
  const totalRainy = months.reduce((s, m) => s + (m.rainyDays ?? 0), 0);
  const hasData = [...series.keys()].some((d) => d.startsWith(String(year)));

  const remarks = hasData
    ? [
        `The average daily rainfall in ${year}${year === thisYear ? ' so far' : ''} is ${a.average.toFixed(2)} mm/day` +
          (change !== null
            ? `, which is ${Math.abs(change)}% ${change >= 0 ? 'higher' : 'lower'} than ${compare} (${c.average.toFixed(2)} mm/day).`
            : `; ${compare} had ${c.average.toFixed(2)} mm/day.`),
        highest && lowest
          ? `The highest monthly average rainfall was ${(highest.avgRainfall ?? 0).toFixed(2)} mm/day in ${highest.name}, and the lowest was ${(lowest.avgRainfall ?? 0).toFixed(2)} mm/day in ${lowest.name}.`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    : `No submitted weather entries for ${year} yet.`;

  return {
    year,
    compare,
    months,
    compareMonths,
    body: {
      estate: scope.estate,
      estateName: scope.estateName,
      station: scope.station,
      stationName: scope.stationName,
      year,
      compare,
      cards: {
        averageRainfall: {
          value: currentRow?.avgRainfall ?? null,
          month: current,
          monthName: currentRow?.name ?? null,
        },
        highestMonthlyAverage:
          hasData && highest
            ? { value: highest.avgRainfall, month: highest.month, monthName: highest.name }
            : null,
        lowestMonthlyAverage:
          hasData && lowest
            ? { value: lowest.avgRainfall, month: lowest.month, monthName: lowest.name }
            : null,
        annualAverage: a.average,
        monthsWithRain: started.filter((m) => (m.avgRainfall ?? 0) >= RAINY_MM).length,
      },
      chart: months.map((m, i) => ({
        month: m.month,
        label: m.label,
        year: m.avgRainfall,
        compare: compareMonths[i]?.avgRainfall ?? null,
      })),
      table: months.map((m) => ({ ...m, isCurrent: year === thisYear && m.month === current })),
      total: {
        totalRainfall: a.total,
        rainyDays: totalRainy,
        annualAverage: a.average,
        daysCounted: yearDays(year),
      },
      compareTotal: { totalRainfall: c.total, annualAverage: c.average },
      changePercent: change,
      trend: [year - 4, year - 3, year - 2, year - 1, year].map((y) => ({
        year: y,
        average: annual(y).average,
        upToDate: y === thisYear,
      })),
      remarks,
    },
  };
}

weatherAverageRainfallRouter.get('/monthly-average-rainfall', async (req, res) => {
  res.json((await build(req.query)).body);
});

weatherAverageRainfallRouter.get('/monthly-average-rainfall/export', async (req, res) => {
  const format = exportFormat(req.query.format);
  const { year, compare, months, compareMonths, body } = await build(req.query);
  const rows: Record<string, unknown>[] = months.map((m, i) => ({
    month: m.name,
    total: m.totalRainfall,
    rainy: m.rainyDays,
    average: m.avgRainfall,
    compare: compareMonths[i]?.avgRainfall ?? null,
  }));
  rows.push({
    month: 'Total / Average',
    total: body.total.totalRainfall,
    rainy: body.total.rainyDays,
    average: body.total.annualAverage,
    compare: body.compareTotal.annualAverage,
  });
  await sendExport(res, format, {
    fileName: `monthly-average-rainfall-${year}`,
    sheet: `Average Rainfall ${year}`,
    rows,
    columns: [
      { header: 'Month', value: (r) => r.month, width: 16 },
      { header: 'Total Rainfall (mm)', value: (r) => r.total, width: 18, numFmt: '#,##0.0' },
      { header: 'Rainy Days', value: (r) => r.rainy, width: 12 },
      { header: `Average Rainfall ${year} (mm/day)`, value: (r) => r.average, width: 28, numFmt: '0.00' },
      { header: `Average Rainfall ${compare} (mm/day)`, value: (r) => r.compare, width: 28, numFmt: '0.00' },
    ],
  });
});

docsPaths['/weather/monthly-average-rainfall'] = {
  get: {
    tags: ['Weather'],
    summary:
      'Monthly Average Rainfall for ?estate=<id>[&station=<id>][&year=YYYY][&compare=YYYY]: cards, chart year vs compare, month table with total row, 5-year trend, remarks',
    responses: {
      '200': { description: 'report' },
      '400': { description: 'estate / station / year / compare wrong' },
    },
  },
};
docsPaths['/weather/monthly-average-rainfall/export'] = {
  get: {
    tags: ['Weather'],
    summary: 'The 12 months and the Total / Average row as xlsx (default) or csv; same query plus format',
    responses: { '200': { description: 'file' } },
  },
};
