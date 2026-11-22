import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { bool, list, oneOf, optOneOf, optText, ref, reqDate } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-218 W.2 Daily Weather Entry (`/weather-daily-entry`, `images/5.jpeg`) and the list behind "View Entries"
 * (W.3, `/weather-entries`). One entry per date and station.
 *
 * Decision 2026-11-22: Save as Draft (`entryStatus: DRAFT`) saves at once, without approval, and stays editable.
 * Save & Submit (`SUBMITTED`), and any edit or delete of a submitted entry, go through approval module `weather`
 * when it is On. Only SUBMITTED entries count in the weather dashboard and reports. A submitted entry cannot go
 * back to Draft. Recorded By is the user who created the entry (`createdBy` / `createdByName`).
 *
 * Worked out on save: Average Temperature = (Max + Min) / 2; Average Humidity = (Max + Min) / 2 when both are
 * given; Division / Location = the station's location when left blank. When any of Morning, Afternoon and
 * Evening / Night Rainfall is given, Today's Rainfall (Total) must equal their sum.
 */
const ENTRY_TYPES = [{ value: 'MANUAL', label: 'Manual' }];
const ENTRY_STATUSES = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
];
const RAIN_GAUGE_TYPES = [
  { value: 'MANUAL', label: 'Manual' },
  { value: 'AUTOMATIC', label: 'Automatic' },
];
const WIND_DIRECTIONS = [
  { value: 'N', label: 'N (North)' },
  { value: 'NE', label: 'NE (North-East)' },
  { value: 'E', label: 'E (East)' },
  { value: 'SE', label: 'SE (South-East)' },
  { value: 'S', label: 'S (South)' },
  { value: 'SW', label: 'SW (South-West)' },
  { value: 'W', label: 'W (West)' },
  { value: 'NW', label: 'NW (North-West)' },
];
export const WEATHER_CONDITIONS = [
  { value: 'SUNNY', label: 'Sunny' },
  { value: 'PARTLY_CLOUDY', label: 'Partly Cloudy' },
  { value: 'CLOUDY', label: 'Cloudy' },
  { value: 'LIGHT_RAIN', label: 'Light Rain' },
  { value: 'MODERATE_RAIN', label: 'Moderate Rain' },
  { value: 'HEAVY_RAIN', label: 'Heavy Rain' },
  { value: 'THUNDERSTORM', label: 'Thunderstorm' },
  { value: 'FOGGY', label: 'Foggy' },
];
const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

type Choice = { value: string; label: string };
const valuesOf = (choices: Choice[]) => choices.map((o) => o.value);
export const labelOf = (choices: Choice[], value: unknown) =>
  choices.find((o) => o.value === value)?.label ?? null;
const numbered = (choices: Choice[]) => choices.map((o, i) => ({ id: i + 1, ...o }));

/** Today's date in Bangladesh, as YYYY-MM-DD. */
export const todayDhaka = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

const blank = (v: unknown) => v === '' || v === undefined || v === null;
const toNumber = (v: unknown) =>
  blank(v) ? null : typeof v === 'string' && !Number.isNaN(Number(v.trim())) ? Number(v.trim()) : v;
/** A number between min and max (may be negative when min is), rounded to one decimal place. */
const range = (min: number, max: number) =>
  z
    .number({
      error: (issue) =>
        issue.input === null || issue.input === undefined ? 'This field is required.' : 'Must be a number.',
    })
    .min(min, `Must be ${min} or more.`)
    .max(max, `Must be ${max} or less.`)
    .transform((n) => Math.round(n * 10) / 10);
const reqRange = (min: number, max: number) => z.preprocess(toNumber, range(min, max));
const optRange = (min: number, max: number) => z.preprocess(toNumber, range(min, max).nullable());
/** HH:MM (24-hour); "07:00 AM" style is accepted and turned into 24-hour. */
const clock = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*$/.exec(v);
  if (!m) return v.trim();
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const reqTime = () =>
  z.preprocess(
    clock,
    z
      .string({ error: 'This field is required.' })
      .min(1, 'This field is required.')
      .regex(TIME, 'Use a time like 08:00.'),
  );
const optTime = () =>
  z.preprocess(
    (v) => (blank(v) ? null : clock(v)),
    z.string().regex(TIME, 'Use a time like 08:00.').nullable(),
  );
const optDuration = () =>
  z.preprocess(
    (v) => (blank(v) ? null : typeof v === 'string' ? v.trim() : v),
    z
      .string()
      .regex(/^([01]\d|2[0-4]):[0-5]\d$/, 'Use hours and minutes, like 02:30.')
      .nullable(),
  );

const flag = () => z.preprocess((v) => (blank(v) ? false : v), bool());

const entrySchema = z.object({
  entryDate: reqDate(),
  estate: ref(),
  station: ref(),
  location: optText(160),
  entryType: z.preprocess((v) => (blank(v) ? 'MANUAL' : v), oneOf(valuesOf(ENTRY_TYPES))),
  recordingTime: reqTime(),
  entryStatus: oneOf(valuesOf(ENTRY_STATUSES)),
  totalRainfall: reqRange(0, 1000),
  measurementTime: optTime(),
  rainGaugeType: optOneOf(valuesOf(RAIN_GAUGE_TYPES)),
  rainfallDuration: optDuration(),
  morningRainfall: optRange(0, 1000),
  afternoonRainfall: optRange(0, 1000),
  eveningRainfall: optRange(0, 1000),
  rainfallRemarks: optText(300),
  maxTemperature: reqRange(-10, 60),
  minTemperature: reqRange(-10, 60),
  morningTemperature: optRange(-10, 60),
  afternoonTemperature: optRange(-10, 60),
  eveningTemperature: optRange(-10, 60),
  morningHumidity: optRange(0, 100),
  afternoonHumidity: optRange(0, 100),
  maxHumidity: optRange(0, 100),
  minHumidity: optRange(0, 100),
  windSpeed: optRange(0, 300),
  maxWindSpeed: optRange(0, 300),
  windDirection: optOneOf(valuesOf(WIND_DIRECTIONS)),
  windRemarks: optText(300),
  sunshineHours: optRange(0, 24),
  cloudCoverage: optRange(0, 100),
  weatherCondition: oneOf(valuesOf(WEATHER_CONDITIONS)),
  // Unticked or left out = no.
  fog: flag(),
  thunderstorm: flag(),
  hailstorm: flag(),
  generalRemarks: optText(1000),
  attachments: list(),
});

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const one = (v: number) => Math.round(v * 10) / 10;

/** Only entries in this state count in the dashboard and reports. */
export const COUNTED = { entryStatus: 'SUBMITTED', deletedAt: null } as const;

export const weatherEntriesRouter = defineResource('/weather-entries', {
  name: 'weatherEntry',
  label: 'Weather entry',
  module: 'weather',
  page: 'Daily Weather Entry',
  describe: (r) =>
    show(
      typeof r.entryDate === 'string' ? r.entryDate : '',
      paren(typeof r.stationName === 'string' ? r.stationName : ''),
    ),
  model: 'weatherEntry',
  schema: entrySchema,
  search: ['location', 'rainfallRemarks', 'windRemarks', 'generalRemarks'],
  searchAlso: (term) => [{ stationRef: { stationName: { contains: term } } }],
  filters: [
    'estate',
    'station',
    'entryStatus',
    'weatherCondition',
    { name: 'dateFrom', where: (v) => ({ entryDate: { gte: new Date(v) } }) },
    { name: 'dateTo', where: (v) => ({ entryDate: { lte: new Date(v) } }) },
  ],
  refs: {
    estate: { model: 'estate', label: 'estateName' },
    station: { model: 'weatherStation', label: 'stationName' },
  },
  files: ['attachments'],
  unique: [{ field: 'entryDate', scope: ['station'] }],
  orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  // A draft never waits for approval; submitting, and changing or deleting a submitted entry, does.
  skipApproval: (values, before) =>
    values
      ? values.entryStatus === 'DRAFT' && (!before || before.entryStatus === 'DRAFT')
      : before?.entryStatus === 'DRAFT',
  check: async (values, id) => {
    const fields: Record<string, string> = {};
    const saved = id
      ? await db.weatherEntry.findUnique({ where: { id }, select: { station: true, entryStatus: true } })
      : null;
    if (saved?.entryStatus === 'SUBMITTED' && values.entryStatus === 'DRAFT')
      fields.entryStatus = 'A submitted entry cannot go back to Draft.';
    if (values.entryDate instanceof Date && dayOf(values.entryDate) > todayDhaka())
      fields.entryDate = 'Entry date cannot be in the future.';
    if (typeof values.station === 'string') {
      const station = await db.weatherStation.findFirst({
        where: { id: values.station, deletedAt: null },
        select: { estate: true, status: true },
      });
      if (station && station.estate !== values.estate)
        fields.station = 'This station is not in the selected estate.';
      else if (station && station.status !== 'active' && saved?.station !== values.station)
        fields.station = 'This station is Inactive.';
    }
    const parts = [values.morningRainfall, values.afternoonRainfall, values.eveningRainfall].map(n);
    if (parts.some((p) => p !== null)) {
      const sum = one(parts.reduce<number>((a, p) => a + (p ?? 0), 0));
      if (Math.abs(sum - (n(values.totalRainfall) ?? 0)) > 0.05)
        fields.totalRainfall = `Total must equal Morning + Afternoon + Evening / Night (${sum.toFixed(1)} mm).`;
    }
    const maxT = n(values.maxTemperature);
    const minT = n(values.minTemperature);
    if (maxT !== null && minT !== null && minT > maxT)
      fields.minTemperature = 'Minimum temperature cannot be above the maximum.';
    const maxH = n(values.maxHumidity);
    const minH = n(values.minHumidity);
    if (maxH !== null && minH !== null && minH > maxH)
      fields.minHumidity = 'Minimum humidity cannot be above the maximum.';
    const wind = n(values.windSpeed);
    const gust = n(values.maxWindSpeed);
    if (wind !== null && gust !== null && gust < wind)
      fields.maxWindSpeed = 'Maximum wind speed cannot be below the wind speed.';
    const files = (values.attachments ?? []) as string[];
    if (files.length > MAX_ATTACHMENTS) fields.attachments = `At most ${MAX_ATTACHMENTS} files.`;
    else if (files.length) {
      const stored = await db.storedFile.findMany({
        where: { id: { in: files } },
        select: { type: true, size: true },
      });
      if (stored.some((f) => !ATTACHMENT_TYPES.includes(f.type)))
        fields.attachments = 'Use PDF, JPG or PNG files.';
      else if (stored.some((f) => f.size > ATTACHMENT_MAX_BYTES))
        fields.attachments = 'Each file must be 5 MB or smaller.';
    }
    return fields;
  },
  onSave: async (values) => {
    const maxH = n(values.maxHumidity);
    const minH = n(values.minHumidity);
    let location = values.location;
    if (blank(location) && typeof values.station === 'string')
      location =
        (await db.weatherStation.findUnique({ where: { id: values.station }, select: { location: true } }))
          ?.location ?? '';
    return {
      location,
      avgTemperature: one(((n(values.maxTemperature) ?? 0) + (n(values.minTemperature) ?? 0)) / 2),
      avgHumidity: maxH !== null && minH !== null ? one((maxH + minH) / 2) : null,
    };
  },
  extend: (row) => ({
    entryTypeLabel: labelOf(ENTRY_TYPES, row.entryType),
    entryStatusLabel: labelOf(ENTRY_STATUSES, row.entryStatus),
    rainGaugeTypeLabel: labelOf(RAIN_GAUGE_TYPES, row.rainGaugeType),
    windDirectionLabel: labelOf(WIND_DIRECTIONS, row.windDirection),
    weatherConditionLabel: labelOf(WEATHER_CONDITIONS, row.weatherCondition),
    recordedBy: row.createdBy,
  }),
  export: {
    fileName: 'weather-entries',
    sheet: 'Weather Entries',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Date', value: (row) => row.entryDate, width: 12 },
      { header: 'Estate', value: (row) => row.estateName, width: 24 },
      { header: 'Station', value: (row) => row.stationName, width: 26 },
      { header: 'Recording Time', value: (row) => row.recordingTime, width: 10 },
      { header: 'Total Rainfall (mm)', value: (row) => row.totalRainfall, width: 12, numFmt: '0.0' },
      { header: 'Max Temp (°C)', value: (row) => row.maxTemperature, width: 10, numFmt: '0.0' },
      { header: 'Min Temp (°C)', value: (row) => row.minTemperature, width: 10, numFmt: '0.0' },
      { header: 'Avg Temp (°C)', value: (row) => row.avgTemperature, width: 10, numFmt: '0.0' },
      { header: 'Avg Humidity (%)', value: (row) => row.avgHumidity, width: 10, numFmt: '0.0' },
      { header: 'Wind (km/h)', value: (row) => row.windSpeed, width: 10, numFmt: '0.0' },
      { header: 'Wind Direction', value: (row) => row.windDirection, width: 8 },
      { header: 'Sunshine (h)', value: (row) => row.sunshineHours, width: 10, numFmt: '0.0' },
      { header: 'Condition', value: (row) => row.weatherConditionLabel, width: 16 },
      { header: 'Status', value: (row) => row.entryStatusLabel, width: 10 },
      { header: 'Recorded By', value: (row) => row.createdByName, width: 20 },
    ],
  },
});

/** Sum of counted rainfall for a station between two dates (inclusive). */
async function rainfallBetween(station: string, from: Date, to: Date) {
  const r = await db.weatherEntry.aggregate({
    where: { ...COUNTED, station, entryDate: { gte: from, lte: to } },
    _sum: { totalRainfall: true },
  });
  return one(Number(r._sum.totalRainfall ?? 0));
}

/** The form's dropdowns, the list's filters and the side panels. */
export const weatherEntryExtrasRouter = Router();
weatherEntryExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({
    entryTypes: numbered(ENTRY_TYPES),
    entryStatuses: numbered(ENTRY_STATUSES),
    rainGaugeTypes: numbered(RAIN_GAUGE_TYPES),
    windDirections: numbered(WIND_DIRECTIONS),
    weatherConditions: numbered(WEATHER_CONDITIONS),
    attachmentTypes: ['PDF', 'JPG', 'PNG'],
    maxAttachments: MAX_ATTACHMENTS,
    maxAttachmentMb: 5,
  });
});

/**
 * The right-hand panels for a station and date: the saved entry of that day (any status) for Daily Weather
 * Summary, and Related Information from submitted entries. `rainfall` (the form's current total) is used for
 * "Rainfall Compared to Previous Day" when given.
 */
weatherEntryExtrasRouter.get('/summary', async (req, res) => {
  const station = typeof req.query.station === 'string' ? req.query.station : '';
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  const fields: Record<string, string> = {};
  if (station.length !== 26) fields.station = 'Select a station.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime()))
    fields.date = 'Use a date like 2026-10-16.';
  if (Object.keys(fields).length)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', fields);
  const day = new Date(date);
  const previous = new Date(day.getTime() - 86_400_000);
  const [entry, prevEntry, monthly, ytd] = await Promise.all([
    db.weatherEntry.findFirst({ where: { station, entryDate: day, deletedAt: null } }),
    db.weatherEntry.findFirst({ where: { ...COUNTED, station, entryDate: previous } }),
    rainfallBetween(station, new Date(`${date.slice(0, 7)}-01`), day),
    rainfallBetween(station, new Date(`${date.slice(0, 4)}-01-01`), day),
  ]);
  const given =
    typeof req.query.rainfall === 'string' && req.query.rainfall !== '' ? Number(req.query.rainfall) : null;
  const today = given !== null && !Number.isNaN(given) ? given : n(entry?.totalRainfall);
  const prevRain = n(prevEntry?.totalRainfall);
  res.json({
    station,
    date,
    dailySummary: entry
      ? {
          id: entry.id,
          entryStatus: entry.entryStatus,
          totalRainfall: n(entry.totalRainfall),
          maxTemperature: n(entry.maxTemperature),
          minTemperature: n(entry.minTemperature),
          avgTemperature: n(entry.avgTemperature),
          avgHumidity: n(entry.avgHumidity),
          windSpeed: n(entry.windSpeed),
          windDirection: entry.windDirection,
          sunshineHours: n(entry.sunshineHours),
          weatherCondition: entry.weatherCondition,
          weatherConditionLabel: labelOf(WEATHER_CONDITIONS, entry.weatherCondition),
        }
      : null,
    related: {
      monthlyCumulativeRainfall: monthly,
      yearToDateRainfall: ytd,
      previousDay: dayOf(previous),
      previousDayRainfall: prevRain,
      changeVsPreviousDay: today !== null && prevRain !== null ? one(today - prevRain) : null,
    },
  });
});

docsPaths['/weather-entries/filter-options'] = {
  get: {
    tags: ['Weather entry'],
    summary:
      'Daily Weather Entry options: entryTypes, entryStatuses, rainGaugeTypes, windDirections, weatherConditions, attachment limits',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
docsPaths['/weather-entries/summary'] = {
  get: {
    tags: ['Weather entry'],
    summary:
      "Side panels for ?station=&date=YYYY-MM-DD[&rainfall=]: { dailySummary (that day's entry or null), related { monthlyCumulativeRainfall, yearToDateRainfall, previousDay, previousDayRainfall, changeVsPreviousDay } }",
    responses: { '200': { description: 'panels' }, '400': { description: 'station / date missing' } },
  },
};
