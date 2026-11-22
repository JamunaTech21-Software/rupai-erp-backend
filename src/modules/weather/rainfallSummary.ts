import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { exportFormat, sendExport } from '../../lib/export.js';
import { todayDhaka } from './entries.js';
import {
  RAINY_MM,
  type Day,
  dailySeries,
  dayLabel,
  daysInMonth,
  monthEnd,
  monthLabel,
  monthStats,
  one,
  readMonth,
  readScope,
  shiftMonth,
  totalUpTo,
  two,
} from './stats.js';

/**
 * RP1-226 W.5 Monthly Rainfall Summary (`/weather-monthly-rainfall-summary`, `images/2.png`):
 * `GET /weather/monthly-rainfall-summary?estate=&station=&month=YYYY-MM&compare=YYYY-MM` and its Excel export
 * (`/export`, one row per day). Month defaults to this month, Compare With to the same month last year. A running
 * month counts up to today. Remarks is a sentence built from the numbers.
 */
export const weatherRainfallSummaryRouter = Router();

const sign = (v: number) => (v > 0 ? '+' : '');
const fmt = (v: number) => v.toFixed(1);

async function build(query: Record<string, unknown>) {
  const scope = await readScope(query);
  const month = readMonth(query.month, 'month', todayDhaka().slice(0, 7));
  const compare = readMonth(query.compare, 'compare', shiftMonth(month, -12));
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const end = monthEnd(month);
  const trendStart = shiftMonth(month, -11);
  const from = [`${year}-01`, trendStart, compare, shiftMonth(month, -12)].sort()[0] ?? trendStart;
  const series = await dailySeries(scope, `${from}-01`, end);
  const stats = monthStats(series, year, m, end);
  const total = stats.totalRainfall ?? 0;

  const prevMonth = shiftMonth(month, -1);
  const lastYear = shiftMonth(month, -12);
  const monthTotal = (key: string) => totalUpTo(series, `${key}-01`, monthEnd(key));
  const previousMonthRainfall = monthTotal(prevMonth);
  const lastYearRainfall = monthTotal(lastYear);
  const compareRainfall = monthTotal(compare);
  const change = one(total - lastYearRainfall);
  const changePercent = lastYearRainfall > 0 ? one((change / lastYearRainfall) * 100) : null;

  const days = Array.from(
    { length: daysInMonth(year, m) },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
  const daily = days.map((d) => ({
    date: d,
    day: Number(d.slice(8)),
    rainfall: series.get(d)?.rainfall ?? null,
  }));

  const compareDiff = one(total - compareRainfall);
  const comparePercent = compareRainfall > 0 ? one((compareDiff / compareRainfall) * 100) : null;
  const compareName = compare === lastYear ? 'the same month last year' : monthLabel(compare);
  const remarks = stats.daysWithData
    ? [
        `Total rainfall in ${monthLabel(month)}${end < `${month}-${String(days.length).padStart(2, '0')}` ? ' so far' : ''} was ${fmt(total)} mm` +
          (comparePercent !== null
            ? `, which is ${Math.abs(comparePercent)}% ${comparePercent >= 0 ? 'higher' : 'lower'} than ${compareName} (${fmt(compareRainfall)} mm).`
            : `; ${compareName} had ${fmt(compareRainfall)} mm.`),
        `A total of ${stats.rainyDays ?? 0} rainy ${stats.rainyDays === 1 ? 'day was' : 'days were'} recorded` +
          (stats.highestDailyRainfall && stats.highestDailyRainfall.value >= RAINY_MM
            ? `, with the highest daily rainfall of ${fmt(stats.highestDailyRainfall.value)} mm on ${dayLabel(stats.highestDailyRainfall.date)}.`
            : '.'),
      ].join(' ')
    : `No submitted weather entries for ${monthLabel(month)} yet.`;

  const point = (p: { value: number; date: string } | null) =>
    p ? { value: p.value, date: p.date, dateLabel: dayLabel(p.date, false) } : null;

  return {
    scope,
    month,
    end,
    daily,
    series,
    body: {
      estate: scope.estate,
      estateName: scope.estateName,
      station: scope.station,
      stationName: scope.stationName,
      month,
      monthLabel: monthLabel(month),
      compare,
      compareLabel: monthLabel(compare),
      upTo: end,
      cards: {
        monthlyRainfall: total,
        rainyDays: stats.rainyDays ?? 0,
        highestDailyRainfall: point(stats.highestDailyRainfall),
        lowestDailyRainfall: point(stats.lowestDailyRainfall),
        dailyAverage: stats.avgDailyRainfall ?? 0,
      },
      dailyRainfall: daily,
      monthlySummary: {
        totalRainfall: total,
        rainyDays: stats.rainyDays ?? 0,
        highestDailyRainfall: point(stats.highestDailyRainfall),
        lowestDailyRainfall: point(stats.lowestDailyRainfall),
        dailyAverageRainfall: stats.avgDailyRainfall ?? 0,
        monthlyCumulativeYtd: totalUpTo(series, `${year}-01-01`, end),
        previousMonth: {
          month: prevMonth,
          label: monthLabel(prevMonth, true),
          rainfall: previousMonthRainfall,
        },
        sameMonthLastYear: { month: lastYear, label: monthLabel(lastYear, true), rainfall: lastYearRainfall },
        changeVsLastYear: {
          mm: change,
          percent: changePercent,
          text: `${sign(change)}${fmt(change)} mm${changePercent !== null ? ` (${sign(changePercent)}${changePercent}%)` : ''}`,
        },
        daysWithData: stats.daysWithData,
      },
      comparison: {
        label: monthLabel(month).split(' ')[0],
        current: { month, label: monthLabel(month, true), rainfall: total },
        compare: { month: compare, label: monthLabel(compare, true), rainfall: compareRainfall },
        difference: compareDiff,
        percent: comparePercent,
      },
      trend: Array.from({ length: 12 }, (_, i) => {
        const key = shiftMonth(trendStart, i);
        return {
          month: key,
          label: monthLabel(key, true).split(' ')[0],
          year: Number(key.slice(0, 4)),
          rainfall: monthTotal(key),
        };
      }),
      remarks,
    },
  };
}

weatherRainfallSummaryRouter.get('/monthly-rainfall-summary', async (req, res) => {
  res.json((await build(req.query)).body);
});

weatherRainfallSummaryRouter.get('/monthly-rainfall-summary/export', async (req, res) => {
  const format = exportFormat(req.query.format);
  const { body, daily, series } = await build(req.query);
  let running = 0;
  const rows: Record<string, unknown>[] = daily.map((d) => {
    const day: Day | undefined = series.get(d.date);
    if (day) running = one(running + day.rainfall);
    return {
      date: d.date,
      rainfall: day ? day.rainfall : null,
      rainy: day ? (day.rainfall >= RAINY_MM ? 'Yes' : 'No') : null,
      cumulative: day ? running : null,
      condition: day?.weatherCondition ?? null,
    };
  });
  rows.push({
    date: 'Total',
    rainfall: body.cards.monthlyRainfall,
    rainy: `${body.cards.rainyDays} days`,
    cumulative: `Daily average ${two(body.cards.dailyAverage)} mm/day`,
    condition: null,
  });
  await sendExport(res, format, {
    fileName: `monthly-rainfall-summary-${body.month}`,
    sheet: body.monthLabel,
    rows,
    columns: [
      { header: 'Date', value: (r) => r.date, width: 12 },
      { header: 'Rainfall (mm)', value: (r) => r.rainfall, width: 14, numFmt: '0.0' },
      { header: 'Rainy Day (>= 0.1 mm)', value: (r) => r.rainy, width: 20 },
      { header: 'Cumulative (mm)', value: (r) => r.cumulative, width: 26, numFmt: '0.0' },
      { header: 'Condition', value: (r) => r.condition, width: 16 },
    ],
  });
});

docsPaths['/weather/monthly-rainfall-summary'] = {
  get: {
    tags: ['Weather'],
    summary:
      'Monthly Rainfall Summary for ?estate=<id>[&station=<id>][&month=YYYY-MM][&compare=YYYY-MM]: cards, daily rainfall, monthly summary, comparison, 12-month trend, remarks',
    responses: {
      '200': { description: 'summary' },
      '400': { description: 'estate / station / month / compare wrong' },
    },
  },
};
docsPaths['/weather/monthly-rainfall-summary/export'] = {
  get: {
    tags: ['Weather'],
    summary: 'The month day by day as xlsx (default) or csv; same query plus format',
    responses: { '200': { description: 'file' } },
  },
};
