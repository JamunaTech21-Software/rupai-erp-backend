import { type Database } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';
import { seedOne } from './util.js';

/**
 * RP1-215 the design's four stations (`images/4.jpeg`, `6.jpeg`) at Jamuna Tea Estate, all Manual for now
 * (decision 2026-11-22: IoT / API later). Added once (by Station ID).
 */
const STATIONS = [
  ['WS-001', 'Main Weather Station', 'Estate Office (Main)', 24.9012, 91.8594, 92],
  ['WS-002', 'North Division Station', 'North Division', 24.9124, 91.8531, 98],
  ['WS-003', 'South Division Station', 'South Division', 24.8897, 91.8642, 88],
  ['WS-004', 'Factory Station', 'Factory Area', 24.8985, 91.8701, 90],
] as const;
const MAPPING = [
  'RAINFALL',
  'MAX_TEMPERATURE',
  'MIN_TEMPERATURE',
  'AVG_TEMPERATURE',
  'HUMIDITY',
  'WIND_SPEED',
  'WIND_DIRECTION',
  'SUNSHINE_HOURS',
];
const SENSORS = [
  ['Rain Gauge', 'RAINFALL', 'mm'],
  ['Thermometer (Max / Min)', 'TEMPERATURE', '°C'],
  ['Hygrometer', 'HUMIDITY', '%'],
] as const;

export async function seedWeatherStations(db: Database, userId: string): Promise<number> {
  const estate = await db.estate.findFirst({ where: { estateCode: 'JTE-001', deletedAt: null } });
  if (!estate) return 0;
  let n = 0;
  for (const [stationCode, stationName, location, latitude, longitude, elevation] of STATIONS) {
    const stationId = await seedOne(
      db,
      userId,
      'weatherStation',
      { stationCode },
      {
        stationCode,
        stationName,
        estate: estate.id,
        location,
        entryType: 'MANUAL',
        status: 'active',
        installationDate: new Date('2026-07-01'),
        latitude,
        longitude,
        elevation,
        timezone: 'Asia/Dhaka',
        dataMapping: stationCode === 'WS-001' ? MAPPING : ['RAINFALL'],
      },
    );
    if (!(await db.weatherStationSensor.count({ where: { stationId } })))
      await db.weatherStationSensor.createMany({
        data: (stationCode === 'WS-001' ? SENSORS : SENSORS.slice(0, 1)).map(
          ([sensorName, parameter, unit], position) => ({
            id: newId(),
            stationId,
            position,
            sensorName,
            parameter,
            unit,
            status: 'online',
          }),
        ),
      });
    n += 1;
  }
  return n;
}
