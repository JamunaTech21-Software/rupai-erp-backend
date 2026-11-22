/**
 * RP1-218 demo data, dev only: `npm run seed:weather-demo`. Two years of daily weather entries (1 Jan last year
 * to yesterday, Submitted) for Main Weather Station (WS-001), so the weather dashboard and reports (W.4 to W.7)
 * have something to show while they are built. Never part of `npm run seed` and never for real data. Days that
 * already have an entry are left alone, so it is safe to run again. The values follow a Sylhet-like year
 * (dry winter, monsoon June to September) from a fixed random seed, so every run gives the same numbers.
 */
import { db } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';
import { logger } from '../../src/lib/logger.js';

// Per month (Jan..Dec): chance of a rainy day, mean rain on a rainy day (mm), mean max / min temp, humidity.
const RAIN_CHANCE = [0.08, 0.15, 0.25, 0.4, 0.55, 0.7, 0.75, 0.72, 0.6, 0.38, 0.18, 0.08];
const RAIN_MEAN = [4, 9, 11, 17, 19, 23, 27, 26, 24, 18, 12, 6];
const MAX_T = [24.5, 27, 30.5, 31.5, 32, 32, 32, 32.3, 32, 31, 29, 25.5];
const MIN_T = [11, 13.5, 17.5, 21, 23, 24.8, 25.2, 25.3, 24.5, 22, 17, 12.5];
const HUMIDITY = [72, 65, 66, 76, 82, 88, 89, 88, 86, 82, 77, 74];
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** mulberry32: a small fixed-seed random generator. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const one = (v: number) => Math.round(v * 10) / 10;
const at = (list: number[], i: number) => list[i] ?? 0;

async function main() {
  const station = await db.weatherStation.findFirst({ where: { stationCode: 'WS-001', deletedAt: null } });
  const admin = await db.user.findFirst({ where: { username: 'admin' } });
  if (!station || !admin) {
    logger.error('Run `npm run seed` first: Main Weather Station (WS-001) or the admin user is missing.');
    process.exitCode = 1;
    return;
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  const start = new Date(`${Number(today.slice(0, 4)) - 1}-01-01`);
  const end = new Date(new Date(today).getTime() - 86_400_000);
  const taken = new Set(
    (
      await db.weatherEntry.findMany({
        where: { station: station.id, deletedAt: null },
        select: { entryDate: true },
      })
    ).map((e) => e.entryDate.toISOString().slice(0, 10)),
  );
  const rnd = random(20261122);
  const rows: Record<string, unknown>[] = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const day = d.toISOString().slice(0, 10);
    const m = d.getUTCMonth();
    // Draw every value even for a taken day, so the other days keep the same numbers.
    const rainy = rnd() < at(RAIN_CHANCE, m);
    const rain = rainy ? one(Math.max(0.2, at(RAIN_MEAN, m) * -Math.log(1 - rnd() * 0.98))) : 0;
    const maxT = one(at(MAX_T, m) + (rnd() - 0.5) * 3 - (rainy ? 1 : 0));
    const minT = one(Math.min(maxT - 3, at(MIN_T, m) + (rnd() - 0.5) * 2.5));
    const hum = at(HUMIDITY, m) + (rainy ? 5 : 0);
    const maxH = Math.min(100, Math.round(hum + 5 + rnd() * 4));
    const minH = Math.max(30, Math.round(hum - 8 - rnd() * 4));
    const wind = one(4 + rnd() * 8);
    const sunshine = one(Math.max(0, (rainy ? 3 : 7.5) + (rnd() - 0.5) * 3));
    const direction = DIRECTIONS[Math.floor(rnd() * DIRECTIONS.length)] ?? 'N';
    if (taken.has(day)) continue;
    const morning = rainy ? one(rain * 0.4) : null;
    const afternoon = rainy ? one(rain * 0.35) : null;
    const evening = rainy ? one(rain - (morning ?? 0) - (afternoon ?? 0)) : null;
    const condition = !rainy
      ? sunshine > 7
        ? 'SUNNY'
        : sunshine > 4
          ? 'PARTLY_CLOUDY'
          : 'CLOUDY'
      : rain < 10
        ? 'LIGHT_RAIN'
        : rain < 30
          ? 'MODERATE_RAIN'
          : 'HEAVY_RAIN';
    rows.push({
      id: newId(),
      entryDate: d,
      estate: station.estate,
      station: station.id,
      location: station.location,
      entryType: 'MANUAL',
      recordingTime: '08:00',
      entryStatus: 'SUBMITTED',
      totalRainfall: rain,
      measurementTime: '07:00',
      rainGaugeType: 'MANUAL',
      morningRainfall: morning,
      afternoonRainfall: afternoon,
      eveningRainfall: evening,
      maxTemperature: maxT,
      minTemperature: minT,
      avgTemperature: one((maxT + minT) / 2),
      maxHumidity: maxH,
      minHumidity: minH,
      avgHumidity: one((maxH + minH) / 2),
      windSpeed: wind,
      maxWindSpeed: one(wind + 3 + rnd() * 5),
      windDirection: direction,
      sunshineHours: sunshine,
      cloudCoverage: rainy ? 80 : Math.round(100 - sunshine * 10),
      weatherCondition: condition,
      thunderstorm: rainy && rain > 30,
      attachments: [],
      generalRemarks: 'Demo data (npm run seed:weather-demo).',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
  }
  for (let i = 0; i < rows.length; i += 200)
    await db.weatherEntry.createMany({ data: rows.slice(i, i + 200) as never });
  logger.info(
    `Weather demo: ${rows.length} entries added for ${station.stationName} (${day(start)} to ${day(end)}).`,
  );
}
const day = (d: Date) => d.toISOString().slice(0, 10);

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Weather demo seed failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
