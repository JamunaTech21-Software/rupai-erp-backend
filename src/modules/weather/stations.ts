import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import {
  coord,
  fileId,
  list,
  oneOf,
  optDate,
  optNum,
  optOneOf,
  optText,
  optUrl,
  ref,
  text,
} from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-215 W.1 Weather Station Setup (`/weather-station-setup`, `images/6.jpeg`): the estates' weather stations,
 * picked by Daily Weather Entry and the weather reports. Approval module `weather`.
 *
 * Decision 2026-11-22: manual entry first. Entry Type may be IoT or API, and Device ID, Data Interval,
 * Communication, Data Endpoint, Installed Sensors and Data Mapping are saved, but nothing connects to a device
 * yet: `iotActive` is false and the Connectivity & Health values are null ("Not active yet" on the page).
 * Latitude and Longitude are required because the Weather Forecast (W.8) uses them. RP1-218: Last Data Received
 * is the latest submitted daily entry; a station with entries cannot be deleted.
 */
const ENTRY_TYPES = [
  { value: 'MANUAL', label: 'Manual' },
  { value: 'IOT', label: 'IoT (Automatic)' },
  { value: 'API', label: 'API' },
];
const DATA_INTERVALS = [
  { value: '5', label: '5 Minutes' },
  { value: '15', label: '15 Minutes' },
  { value: '30', label: '30 Minutes' },
  { value: '60', label: '60 Minutes' },
];
const COMMUNICATIONS = [
  { value: 'MOBILE_DATA', label: '4G / Mobile Data' },
  { value: 'WIFI', label: 'Wi-Fi' },
  { value: 'LORA', label: 'LoRa' },
  { value: 'ETHERNET', label: 'Ethernet' },
];
const TIMEZONES = [
  { value: 'Asia/Dhaka', label: 'Asia/Dhaka (UTC+6)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (UTC+5:30)' },
  { value: 'UTC', label: 'UTC (UTC+0)' },
];
/** Installed Sensors: what each sensor measures, with its usual unit. */
const PARAMETERS = [
  { value: 'RAINFALL', label: 'Rainfall', unit: 'mm' },
  { value: 'TEMPERATURE', label: 'Temperature', unit: '°C' },
  { value: 'HUMIDITY', label: 'Humidity', unit: '%' },
  { value: 'WIND_SPEED', label: 'Wind Speed', unit: 'km/h' },
  { value: 'WIND_DIRECTION', label: 'Wind Direction', unit: '°' },
  { value: 'SUNSHINE', label: 'Sunshine / Radiation', unit: 'W/m²' },
];
const SENSOR_STATUSES = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'faulty', label: 'Faulty' },
];
/** Data Mapping checkboxes, in the design's order. */
const DATA_MAPPING = [
  { value: 'RAINFALL', label: 'Rainfall' },
  { value: 'MAX_TEMPERATURE', label: 'Max Temperature' },
  { value: 'MIN_TEMPERATURE', label: 'Min Temperature' },
  { value: 'AVG_TEMPERATURE', label: 'Average Temperature' },
  { value: 'HUMIDITY', label: 'Humidity' },
  { value: 'WIND_SPEED', label: 'Wind Speed' },
  { value: 'WIND_DIRECTION', label: 'Wind Direction' },
  { value: 'SUNSHINE_HOURS', label: 'Sunshine Hours' },
];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

type Choice = { value: string; label: string };
const valuesOf = (choices: Choice[]) => choices.map((o) => o.value);
const labelOf = (choices: Choice[], value: unknown) => choices.find((o) => o.value === value)?.label ?? null;
const numbered = <T extends Choice>(choices: T[]) => choices.map((o, i) => ({ id: i + 1, ...o }));

const stationSchema = z.object({
  stationCode: text(20),
  stationName: text(120),
  estate: ref(),
  location: text(160),
  entryType: oneOf(valuesOf(ENTRY_TYPES)),
  status: oneOf(valuesOf(STATUSES)),
  deviceId: optText(60),
  installationDate: optDate(),
  dataInterval: optOneOf(valuesOf(DATA_INTERVALS)),
  communication: optOneOf(valuesOf(COMMUNICATIONS)),
  dataEndpoint: optUrl(),
  latitude: coord(90),
  longitude: coord(180),
  elevation: optNum(),
  timezone: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? 'Asia/Dhaka' : v),
    oneOf(valuesOf(TIMEZONES)),
  ),
  photo: fileId(),
  dataMapping: list(),
  remarks: optText(500),
});

const sensorSchema = z.object({
  sensorName: text(120),
  parameter: oneOf(valuesOf(PARAMETERS)),
  unit: optText(20),
  status: oneOf(valuesOf(SENSOR_STATUSES)),
});

/** The next free WS-nnn code (deleted stations count too, so a code is never given twice). */
async function nextStationCode(): Promise<string> {
  const rows = await db.weatherStation.findMany({ select: { stationCode: true } });
  const max = rows.reduce((top, r) => {
    const m = /^WS-(\d+)$/i.exec(r.stationCode);
    return m ? Math.max(top, Number(m[1])) : top;
  }, 0);
  return `WS-${String(max + 1).padStart(3, '0')}`;
}

export const weatherStationsRouter = defineResource('/weather-stations', {
  name: 'weatherStation',
  label: 'Weather station',
  module: 'weather',
  page: 'Weather Station Setup',
  describe: (r) => show(r.stationCode, paren(r.stationName)),
  model: 'weatherStation',
  schema: stationSchema,
  search: ['stationCode', 'stationName', 'location', 'deviceId'],
  searchAlso: (term) => [{ estateRef: { estateName: { contains: term } } }],
  filters: ['estate', 'entryType', 'status'],
  refs: { estate: { model: 'estate', label: 'estateName' } },
  files: ['photo'],
  unique: ['stationCode'],
  children: [{ key: 'sensors', model: 'weatherStationSensor', parentKey: 'stationId', schema: sensorSchema }],
  orderBy: [{ stationCode: 'asc' }, { id: 'asc' }],
  check: async (values) => {
    const fields: Record<string, string> = {};
    const mapping = (values.dataMapping ?? []) as string[];
    if (mapping.some((v) => !valuesOf(DATA_MAPPING).includes(v)))
      fields.dataMapping = 'Select values from the list.';
    if (values.installationDate instanceof Date && values.installationDate > new Date())
      fields.installationDate = 'Installation date cannot be in the future.';
    if (typeof values.photo === 'string') {
      const file = await db.storedFile.findUnique({
        where: { id: values.photo },
        select: { type: true, size: true },
      });
      if (file && !PHOTO_TYPES.includes(file.type)) fields.photo = 'Use a JPG, PNG or WEBP image.';
      else if (file && file.size > PHOTO_MAX_BYTES) fields.photo = 'The photo must be 2 MB or smaller.';
    }
    return fields;
  },
  extend: (row) => ({
    entryTypeLabel: labelOf(ENTRY_TYPES, row.entryType),
    statusLabel: labelOf(STATUSES, row.status),
    dataIntervalLabel: labelOf(DATA_INTERVALS, row.dataInterval),
    communicationLabel: labelOf(COMMUNICATIONS, row.communication),
    timezoneLabel: labelOf(TIMEZONES, row.timezone),
    dataMappingLabels: (Array.isArray(row.dataMapping) ? (row.dataMapping as unknown[]) : []).map(
      (v) => labelOf(DATA_MAPPING, v) ?? String(v),
    ),
    // IoT / API are not connected yet (decision 2026-11-22): the Connectivity & Health cards stay empty.
    iotActive: false,
    connectivity: null,
    deviceHealth: null,
  }),
  /** Installed sensors count and Last Data Received (the latest submitted daily entry, from RP1-218). */
  enrich: async (rows) => {
    const counts = await db.weatherStationSensor.groupBy({
      by: ['stationId'],
      where: { stationId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const sensors = new Map(counts.map((c) => [c.stationId, c._count._all]));
    // Last Data Received: the latest submitted daily entry (date and recording time, Bangladesh time).
    const latest = new Map<string, string>();
    for (const r of rows) {
      const e = await db.weatherEntry.findFirst({
        where: { station: r.id, entryStatus: 'SUBMITTED', deletedAt: null },
        orderBy: [{ entryDate: 'desc' }, { recordingTime: 'desc' }],
        select: { entryDate: true, recordingTime: true },
      });
      if (e) latest.set(r.id, `${e.entryDate.toISOString().slice(0, 10)}T${e.recordingTime}:00+06:00`);
    }
    return new Map(
      rows.map((r) => [
        r.id,
        { totalSensors: sensors.get(r.id) ?? 0, lastDataReceived: latest.get(r.id) ?? null },
      ]),
    );
  },
  deleteCheck: async (row) => {
    const entries = await db.weatherEntry.count({ where: { station: row.id, deletedAt: null } });
    return entries
      ? `This station has ${entries} daily weather ${entries === 1 ? 'entry' : 'entries'}.`
      : undefined;
  },
  export: {
    fileName: 'weather-stations',
    sheet: 'Weather Stations',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Station ID', value: (row) => row.stationCode, width: 12 },
      { header: 'Station Name', value: (row) => row.stationName, width: 28 },
      { header: 'Estate', value: (row) => row.estateName, width: 26 },
      { header: 'Location / Division', value: (row) => row.location, width: 26 },
      { header: 'Entry Type', value: (row) => row.entryTypeLabel, width: 16 },
      { header: 'Device ID', value: (row) => row.deviceId, width: 16 },
      { header: 'Latitude', value: (row) => row.latitude, width: 12 },
      { header: 'Longitude', value: (row) => row.longitude, width: 12 },
      { header: 'Elevation (m)', value: (row) => row.elevation, width: 12 },
      { header: 'Sensors', value: (row) => row.totalSensors, width: 10 },
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
    ],
  },
  options: {
    path: 'weather-stations',
    label: (row) => String(row.stationName),
    filters: ['estate', 'status'],
  },
});

/** The form's dropdowns, the list's filters and the next Station ID. */
export const weatherStationExtrasRouter = Router();
weatherStationExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({
    entryTypes: numbered(ENTRY_TYPES),
    dataIntervals: numbered(DATA_INTERVALS),
    communications: numbered(COMMUNICATIONS),
    timezones: numbered(TIMEZONES),
    parameters: numbered(PARAMETERS),
    sensorStatuses: numbered(SENSOR_STATUSES),
    dataMapping: numbered(DATA_MAPPING),
    statuses: numbered(STATUSES),
    photoTypes: ['JPG', 'PNG', 'WEBP'],
    maxPhotoMb: 2,
  });
});
weatherStationExtrasRouter.get('/next-code', async (_req, res) => {
  res.json({ stationCode: await nextStationCode() });
});
docsPaths['/weather-stations/filter-options'] = {
  get: {
    tags: ['Weather station'],
    summary:
      'Weather Station Setup options: entryTypes, dataIntervals, communications, timezones, parameters (with unit), sensorStatuses, dataMapping, statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
docsPaths['/weather-stations/next-code'] = {
  get: {
    tags: ['Weather station'],
    summary: 'The next free Station ID: { stationCode: "WS-005" }',
    responses: { '200': { description: '{ stationCode }' } },
  },
};
