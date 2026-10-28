import { Router } from 'express';

import { zodFields } from '../../middleware/error-handler.js';
import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import {
  fileId,
  int,
  longText,
  num,
  oneOf,
  optDate,
  optNum,
  optOption,
  optText,
  option,
  ref,
  reqDate,
  text,
} from '../../lib/fields.js';
import { writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId, defineResource } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { z } from '../../lib/validation.js';
import { checkLocation } from '../estate/location.js';

/**
 * RP1-19 B.3 Replanting & Gap Filling: `ReplantingAndGapFilling.jsx` and its data file's `steps`,
 * `stepForms` and `databaseTables`. The page shows each step as labelled values, so the keys here are
 * those labels in camelCase, and each step's table is `rows` (its row keys are the data file's).
 *
 *   /replanting-projects                  step 1 Project Information: create (project ID generated), list, edit…
 *   GET|PUT /replanting-projects/:id/steps/:step   steps 2–8, saved one by one (GET also gives step 1)
 */
const STEP_TITLES = [
  'Project Information',
  'Gap Survey Entry',
  'Land Preparation',
  'Material Planning',
  'Labour Allocation',
  'Planting Execution',
  'Progress Monitoring',
  'Approval & Completion',
] as const;

const projectSchema = z.object({
  projectName: text(),
  estate: ref(),
  division: ref(),
  section: ref(),
  fieldBlock: ref(),
  replantingType: option(),
  season: optOption(),
  surveyDate: reqDate(),
  targetDate: optDate(),
  supervisor: optText(),
  remarks: longText(),
});

async function checkProject(values: Record<string, unknown>): Promise<Record<string, string>> {
  const fields = await checkLocation(values);
  if (
    values.targetDate instanceof Date &&
    values.surveyDate instanceof Date &&
    values.targetDate < values.surveyDate
  )
    fields.targetDate = 'Target Date cannot be before Survey Date.';
  return fields;
}

/** RP-<year>-<nnn>, the next number of the year. */
async function nextProjectCode(): Promise<string> {
  const prefix = `RP-${new Date().getFullYear()}-`;
  const last = await db.replantingProject.findFirst({
    where: { projectCode: { startsWith: prefix } },
    orderBy: { projectCode: 'desc' },
    select: { projectCode: true },
  });
  const n = last ? Number.parseInt(last.projectCode.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

const projectStatus = (row: Record<string, unknown>) =>
  row.completionDate ? 'Completed' : Number(row.lastStep) > 1 ? 'Running' : 'Pending';

export const replantingRouter = defineResource('/replanting-projects', {
  name: 'replantingProject',
  label: 'Replanting project',
  model: 'replantingProject',
  schema: projectSchema,
  search: ['projectName', 'projectCode', 'supervisor'],
  filters: ['estate', 'division', 'section', 'fieldBlock', 'replantingType'],
  refs: {
    estate: { model: 'estate', label: 'estateName' },
    division: { model: 'division', label: 'divisionName' },
    section: { model: 'section', label: 'sectionName' },
    fieldBlock: { model: 'fieldBlock', label: 'fieldCode' },
  },
  check: checkProject,
  onCreate: async () => ({ projectCode: await nextProjectCode(), lastStep: 1 }),
  extend: (row) => ({
    projectStatus: projectStatus(row),
    currentStep: Math.min(8, Number(row.lastStep) + (row.completionDate ? 0 : 1)),
    steps: STEP_TITLES.map((title, i) => ({ step: i + 1, title, done: i + 1 <= Number(row.lastStep) })),
  }),
  summary: async (where) => {
    const [total, completed, pending] = await Promise.all([
      db.replantingProject.count({ where }),
      db.replantingProject.count({ where: { ...where, completionDate: { not: null } } }),
      db.replantingProject.count({ where: { ...where, lastStep: 1, completionDate: null } }),
    ]);
    return { totalProjects: total, pending, running: total - completed - pending, completed };
  },
  options: {
    path: 'replanting-projects',
    label: (row) => `${String(row.projectCode)} ${String(row.projectName)}`,
    filters: ['estate', 'fieldBlock'],
  },
});

// ------------------------------------------------------------------------------------------------
// Steps 2–8
// ------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
interface RowTable {
  findMany(args: object): Promise<Row[]>;
  deleteMany(args: object): Promise<unknown>;
  createMany(args: object): Promise<unknown>;
}
interface Step {
  /** Master columns the step saves (its labelled fields). */
  fields: z.ZodObject;
  /** The step's table: Prisma model and one row's schema. */
  rows?: { model: string; schema: z.ZodObject; compute?: (row: Row) => Row };
  summary?: (rows: Row[], project: Row) => unknown;
}

const sum = (rows: Row[], key: string) =>
  Math.round(rows.reduce((s, r) => s + Number(r[key] ?? 0), 0) * 100) / 100;

const STEPS: Record<number, Step> = {
  2: {
    fields: z.object({ gapSurveyDate: optDate(), surveyBy: optText() }),
    rows: {
      model: 'replantingGap',
      schema: z.object({
        gapId: text(60),
        gapSize: num(),
        plants: int(),
        gapType: option(),
        location: optText(),
        status: optOption(),
      }),
    },
    summary: (rows) => ({
      totalGaps: rows.length,
      totalGapSize: sum(rows, 'gapSize'),
      totalPlants: sum(rows, 'plants'),
    }),
  },
  3: {
    fields: z.object({}),
    rows: {
      model: 'replantingPreparation',
      schema: z
        .object({ activity: text(100), startDate: reqDate(), endDate: reqDate(), status: option() })
        .refine((r) => r.endDate >= r.startDate, {
          message: 'End Date cannot be before Start Date.',
          path: ['endDate'],
        }),
    },
  },
  4: {
    fields: z.object({
      plantVariety: optOption(),
      planningDate: optDate(),
      store: optOption(),
      preparedBy: optText(),
      materialRemarks: longText(),
    }),
    rows: {
      model: 'replantingMaterial',
      schema: z.object({ material: text(100), unit: option(), requiredQty: num(), unitCost: num() }),
      compute: (r) => ({
        ...r,
        totalCost: Math.round(Number(r.requiredQty) * Number(r.unitCost) * 100) / 100,
      }),
    },
    summary: (rows) => ({ label: 'Total Estimated Cost', value: sum(rows, 'totalCost') }),
  },
  5: {
    fields: z.object({ labourSource: optOption(), wageType: optOption() }),
    rows: {
      model: 'replantingLabour',
      schema: z.object({ labourType: option(), male: int(), female: int(), rate: num() }),
      compute: (r) => ({ ...r, amount: (Number(r.male) + Number(r.female)) * Number(r.rate) }),
    },
    summary: (rows) => ({
      label: 'Total Labour',
      male: sum(rows, 'male'),
      female: sum(rows, 'female'),
      value: sum(rows, 'amount'),
    }),
  },
  6: {
    fields: z.object({ plantingDate: optDate(), cloneVariety: optOption() }),
    rows: {
      model: 'replantingPlantingRow',
      schema: z
        .object({ rowNo: int(), fromPlant: int(), toPlant: int(), plantedBy: optText(100) })
        .refine((r) => r.toPlant >= r.fromPlant, {
          message: 'To Plant No. cannot be less than From Plant No.',
          path: ['toPlant'],
        }),
      compute: (r) => ({ ...r, plants: Number(r.toPlant) - Number(r.fromPlant) + 1 }),
    },
    summary: (rows) => ({ label: 'Total Plants Planted', value: sum(rows, 'plants') }),
  },
  7: {
    fields: z.object({ tillDate: optDate() }),
    rows: {
      model: 'replantingProgress',
      schema: z.object({
        date: reqDate(),
        areaCompleted: num(),
        plantsPlanted: int(),
        survival: optNum().refine((v) => v === null || v <= 100, 'Survival is at most 100%.'),
        remarks: longText(),
      }),
    },
    /** Progress against the gap survey (step 2): area and plants to fill, planted so far. */
    summary: async (rows, project) => {
      const gaps = await db.replantingGap.findMany({ where: { replantingId: project.id as string } });
      const totalPlants = gaps.reduce((s, g) => s + g.plants, 0);
      const planted = sum(rows, 'plantsPlanted');
      return {
        totalArea: Math.round(gaps.reduce((s, g) => s + Number(g.gapSize), 0) * 100) / 100,
        totalPlants,
        plantedPlants: planted,
        progress: totalPlants ? Math.min(100, Math.round((planted / totalPlants) * 100)) : 0,
      };
    },
  },
  8: {
    fields: z.object({
      completionDate: optDate(),
      survival90Days: optNum().refine((v) => v === null || v <= 100, 'Survival is at most 100%.'),
      completionRemarks: longText(),
    }),
    rows: {
      model: 'replantingApproval',
      schema: z.object({
        level: text(60),
        name: optText(),
        designation: optText(60),
        status: oneOf(['Approved', 'Pending', 'Rejected']),
        date: optDate(),
        signature: fileId(),
        remarks: longText(),
      }),
    },
    summary: (rows) => ({ approved: rows.filter((r) => r.status === 'Approved').length, total: rows.length }),
  },
};

const table = (client: unknown, model: string) => (client as Record<string, RowTable>)[model] as RowTable;
const Step = z.coerce.number().int().min(1).max(8);

async function liveProject(id: string) {
  const project = await db.replantingProject.findFirst({ where: { id, deletedAt: null } });
  if (!project) throw notFound('Replanting project');
  return project as unknown as Row & { id: string; lastStep: number };
}

/** One step as the page shows it: its fields, its table rows and the table's summary. */
async function readStep(project: Row & { id: string }, step: number) {
  const field = await db.fieldBlock.findUnique({
    where: { id: project.fieldBlock as string },
    select: { fieldCode: true },
  });
  const base = {
    step,
    title: STEP_TITLES[step - 1],
    projectCode: project.projectCode,
    fieldBlockName: field?.fieldCode ?? null,
  };
  if (step === 1) {
    const [estate, division, section] = await Promise.all([
      db.estate.findUnique({ where: { id: project.estate as string }, select: { estateName: true } }),
      db.division.findUnique({ where: { id: project.division as string }, select: { divisionName: true } }),
      db.section.findUnique({ where: { id: project.section as string }, select: { sectionName: true } }),
    ]);
    return toJson({
      ...base,
      ...Object.fromEntries(Object.keys(projectSchema.shape).map((k) => [k, project[k]])),
      estateName: estate?.estateName ?? null,
      divisionName: division?.divisionName ?? null,
      sectionName: section?.sectionName ?? null,
    });
  }
  const config = STEPS[step] as Step;
  const values = Object.fromEntries(Object.keys(config.fields.shape).map((k) => [k, project[k]]));
  const rows = config.rows
    ? (
        await table(db, config.rows.model).findMany({
          where: { replantingId: project.id },
          orderBy: { position: 'asc' },
        })
      ).map(({ replantingId: _r, position: _p, ...row }) => row)
    : [];
  return toJson({
    ...base,
    ...values,
    rows,
    summary: config.summary ? await config.summary(rows, project) : null,
  });
}

export const replantingStepsRouter = Router();

replantingStepsRouter.get('/:id/steps/:step', async (req, res) => {
  const step = Step.parse(req.params.step);
  res.json(await readStep(await liveProject(req.params.id), step));
});

replantingStepsRouter.put('/:id/steps/:step', async (req, res) => {
  const userId = currentUserId(req);
  const step = Step.parse(req.params.step);
  if (step === 1)
    throw new AppError(
      'VALIDATION',
      'Step 1 is the project itself: save it with PUT /replanting-projects/{id}.',
    );
  const project = await liveProject(req.params.id);
  const config = STEPS[step] as Step;
  const body = (req.body ?? {}) as Record<string, unknown>;

  // The step's fields and every row are checked together (keys like `rows.1.gapSize`).
  const invalid: Record<string, string> = {};
  const parsed = config.fields.safeParse(body);
  if (!parsed.success) Object.assign(invalid, zodFields(parsed.error));
  const rows: Row[] = [];
  if (config.rows) {
    const given = body.rows ?? [];
    if (!Array.isArray(given)) invalid.rows = 'Must be a list.';
    else
      given.forEach((row: unknown, index) => {
        if (row === null || row === undefined) return;
        const one = config.rows?.schema.safeParse(row);
        if (one?.success) rows.push(config.rows?.compute ? config.rows.compute(one.data) : one.data);
        else if (one)
          for (const [k, m] of Object.entries(zodFields(one.error))) invalid[`rows.${index}.${k}`] ??= m;
      });
  }
  if (step === 8) {
    const ids = rows.map((r) => r.signature).filter((v): v is string => typeof v === 'string');
    if (ids.length && (await db.storedFile.count({ where: { id: { in: ids } } })) !== new Set(ids).size)
      invalid.rows = 'Upload the signature again.';
  }
  if (!parsed.success || Object.keys(invalid).length)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', invalid);

  const before = await readStep(project, step);
  await db.$transaction(async (tx) => {
    await tx.replantingProject.update({
      where: { id: project.id },
      data: { ...parsed.data, lastStep: Math.max(project.lastStep, step), updatedBy: userId },
    });
    if (config.rows) {
      const rowTable = table(tx, config.rows.model);
      await rowTable.deleteMany({ where: { replantingId: project.id } });
      if (rows.length)
        await rowTable.createMany({
          data: rows.map((row, position) => ({ ...row, id: newId(), replantingId: project.id, position })),
        });
    }
    await writeHistory(tx, {
      resource: 'replantingProject',
      recordId: project.id,
      action: 'update',
      oldData: before,
      newData: { step, ...parsed.data, rows },
      userId,
    });
  });
  res.json(await readStep(await liveProject(project.id), step));
});

docsPaths['/replanting-projects/{id}/steps/{step}'] = {
  get: {
    tags: ['Replanting project'],
    summary: 'One step (1–8): its fields, `rows` and `summary`',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'step', in: 'path', required: true, schema: { type: 'integer', minimum: 1, maximum: 8 } },
    ],
    responses: {
      '200': { description: '{ step, title, projectCode, fieldBlockName, …fields, rows, summary }' },
      '404': { description: 'Not found' },
    },
  },
  put: {
    tags: ['Replanting project'],
    summary: 'Save step 2–8 (its fields and the whole `rows` table)',
    description: Object.entries(STEPS)
      .map(
        ([n, s]) =>
          `Step ${n}: fields ${Object.keys(s.fields.shape).join(', ') || '—'}; rows ${s.rows ? Object.keys(s.rows.schema instanceof z.ZodObject ? s.rows.schema.shape : {}).join(', ') : '—'}`,
      )
      .join('\n\n'),
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'step', in: 'path', required: true, schema: { type: 'integer', minimum: 2, maximum: 8 } },
    ],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
    responses: { '200': { description: 'The saved step' }, '400': { description: 'Validation' } },
  },
};
