import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import {
  bool,
  fileId,
  num,
  optDate,
  optEmail,
  optInt,
  optNum,
  optOption,
  optPhone,
  option,
  optText,
  reqDate,
  text,
} from '../../lib/fields.js';
import { show } from '../../lib/approval.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { fileUrl } from '../files/service.js';
import { countBy, inThisMonth, label, pct } from './stats.js';

/**
 * RP1-23 C.2 Add New Worker: `AddNewWorker.jsx`. The form is built from `addNewWorkerData.js`, so the keys are
 * its field `name`s (the photo is `workerPhoto`) and the required ones are the fields marked `required`. Select
 * fields keep the page's option values. The two tables on the form are `landDetails` and `dependents`, as in
 * the data file's `initialData`. `workerId` (WRK-10001) is worked out by the server. The Worker Management
 * page's cards and overviews come from `GET /workers/summary`.
 */
const phone = () => optPhone().refine((v) => v !== null, 'This field is required.');
const requiredFile = () => text(26);

export const WORKER_FILES = [
  'workerPhoto',
  'face',
  'rightThumb',
  'leftThumb',
  'resonCardFile',
  'nidFront',
  'nidBack',
  'birthCertificate',
  'nomineeIdCard',
  'trainingCertificate',
  'otherDocument',
] as const;

export const workerSchema = z.object({
  // Basic information
  workerType: option(),
  category: option(),
  title: optOption(),
  firstName: text(),
  middleName: optText(),
  lastName: text(),
  fathersName: text(),
  mothersName: text(),
  dateOfBirth: reqDate(),
  gender: option(),
  bloodGroup: optOption(),
  maritalStatus: option(),
  nationality: option(),
  religion: option(),
  tinNo: optText(60),
  // Employment
  gardenUnit: option(),
  section: option(),
  jobTask: option(),
  workerStatus: option(),
  joinDate: reqDate(),
  employmentType: optOption(),
  jobNature: optOption(),
  numberOfDependents: optInt(),
  reportingTo: optOption(),
  workingLocation: optOption(),
  employmentStatus: optOption(),
  probationEndDate: optDate(),
  // Contact and address
  mobileNo: phone(),
  alternateMobile: optPhone(),
  personalEmail: optEmail(),
  presentAddress: text(5000),
  permanentAddress: text(5000),
  sameAsPresentAddress: bool(),
  district: option(),
  upazila: option(),
  postalCode: optText(20),
  // Distributed agri land
  landDistributed: optOption(),
  landType: optOption(),
  totalLand: optNum(),
  // Reson card
  resonCardNo: optText(60),
  issueDate: optDate(),
  validTill: optDate(),
  reasonDealerOffice: optText(),
  // Additional information
  educationLevel: optOption(),
  skillTraining: optOption(),
  languageKnown: optOption(),
  experienceYear: optInt(),
  emergencyContactName: optText(),
  emergencyContactNo: optPhone(),
  bankName: optText(),
  accountNo: optText(60),
  mobileBanking: optText(60),
  // Photo, biometrics and documents (NID front and back are required)
  ...Object.fromEntries(
    WORKER_FILES.map((f) => [f, f === 'nidFront' || f === 'nidBack' ? requiredFile() : fileId()]),
  ),
});

export const landSchema = z.object({
  plotBlockNo: text(60),
  mouza: optText(120),
  area: num(),
  distributedDate: optDate(),
});

export const dependentSchema = z.object({
  name: text(),
  relation: text(40),
  dateOfBirth: optDate().refine((d) => !d || d <= new Date(), 'Date of birth cannot be in the future.'),
  occupation: optText(120),
});

/** Date rules shared with the worker import (RP1-24). */
export function checkWorkerDates(values: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  const date = (key: string) => (values[key] instanceof Date ? values[key] : null);
  const born = date('dateOfBirth');
  const joined = date('joinDate');
  if (born && born > new Date()) fields.dateOfBirth = 'Date of birth cannot be in the future.';
  else if (born && joined && born >= joined)
    fields.dateOfBirth = 'Date of birth must be before the join date.';
  const probation = date('probationEndDate');
  if (probation && joined && probation < joined)
    fields.probationEndDate = 'Must be on or after the join date.';
  const issued = date('issueDate');
  const valid = date('validTill');
  if (issued && valid && valid < issued) fields.validTill = 'Must be on or after the issue date.';
  return fields;
}

/** The next worker ids, WRK-10001 upwards; `count` ids for an import. */
export async function nextWorkerIds(count = 1): Promise<string[]> {
  const last = await db.worker.findFirst({
    where: { workerId: { startsWith: 'WRK-' } },
    orderBy: { workerId: 'desc' },
    select: { workerId: true },
  });
  const start = last ? Number.parseInt(last.workerId.slice(4), 10) + 1 : 10001;
  return Array.from({ length: count }, (_, i) => `WRK-${start + i}`);
}

/** Defaults the server fills when the form leaves them empty. */
export const workerDefaults = (values: Record<string, unknown>) => ({
  numberOfDependents: values.numberOfDependents ?? 0,
  sameAsPresentAddress: values.sameAsPresentAddress ?? false,
  landDistributed: values.landDistributed ?? 'no',
});

const INACTIVE = ['inactive', 'suspended', 'retired'];

/**
 * RP1-79 J.2 Worker Management: the Add New Worker form's option lists (`addNewWorkerData.js`), so the page's
 * filters and columns use the values the form saves. The page's "Category" (Plucking, Pruning, …) is the
 * form's Job / Task.
 */
const opts = (pairs: [string, string][]) =>
  pairs.map(([value, text], i) => ({ id: i + 1, value, label: text }));
export const WORKER_OPTIONS = {
  workerType: opts([
    ['permanent', 'Permanent'],
    ['temporary', 'Temporary'],
    ['contractual', 'Contractual'],
    ['seasonal', 'Seasonal'],
  ]),
  category: opts([
    ['general-worker', 'General Worker'],
    ['skilled-worker', 'Skilled Worker'],
    ['semi-skilled-worker', 'Semi Skilled Worker'],
    ['technical-worker', 'Technical Worker'],
  ]),
  gardenUnit: opts([
    ['rupai-tea-estate', 'Rupai Tea Estate'],
    ['jamuna-tea-estate', 'Jamuna Tea Estate'],
    ['fultali-tea-estate', 'Fultali Tea Estate'],
    ['madhabpur-tea-estate', 'Madhabpur Tea Estate'],
  ]),
  section: opts([
    ['section-a', 'Section A'],
    ['section-b', 'Section B'],
    ['section-c', 'Section C'],
    ['section-d', 'Section D'],
  ]),
  jobTask: opts([
    ['tea-plucking', 'Tea Plucking'],
    ['pruning', 'Pruning'],
    ['weeding', 'Weeding'],
    ['plantation', 'Plantation'],
    ['fertilizer-application', 'Fertilizer Application'],
    ['pesticide-application', 'Pesticide Application'],
    ['field-maintenance', 'Field Maintenance'],
    ['factory-worker', 'Factory Worker'],
  ]),
  workerStatus: opts([
    ['active', 'Active'],
    ['inactive', 'Inactive'],
    ['on-leave', 'On Leave'],
    ['suspended', 'Suspended'],
    ['retired', 'Retired'],
  ]),
};
type OptionKey = keyof typeof WORKER_OPTIONS;
const optionLabel = (key: OptionKey, value: unknown) =>
  typeof value === 'string'
    ? (WORKER_OPTIONS[key].find((o) => o.value === value)?.label ?? label(value))
    : null;
const COLORS = ['#15803d', '#2563eb', '#f59e0b', '#9333ea', '#ef4444', '#14b8a6', '#64748b', '#ec4899'];

/** The profile panel's document list (the prototype's names), Uploaded / Missing from the worker's fields. */
const DOCUMENTS: { id: string; name: string; icon: string; field: string; file: boolean }[] = [
  { id: 'nid-front', name: 'NID Card (Front)', icon: 'upload', field: 'nidFront', file: true },
  { id: 'nid-back', name: 'NID Card (Back)', icon: 'upload', field: 'nidBack', file: true },
  { id: 'passport-photo', name: 'Passport Size Photo', icon: 'upload', field: 'workerPhoto', file: true },
  // No file is kept for the bank account: it counts as given when the account number is filled in.
  { id: 'bank-account', name: 'Bank Account', icon: 'bank', field: 'accountNo', file: false },
  { id: 'other-document', name: 'Other Document', icon: 'document', field: 'otherDocument', file: true },
];
const given = (v: unknown) => typeof v === 'string' && v.trim() !== '';

export const workersRouter = defineResource('/workers', {
  name: 'worker',
  label: 'Worker',
  module: 'hr',
  page: 'Worker',
  describe: (r) => show(r.workerId ?? 'New', `(${show(r.firstName, r.middleName, r.lastName)})`),
  model: 'worker',
  schema: workerSchema,
  search: ['workerId', 'firstName', 'middleName', 'lastName', 'fathersName', 'mobileNo'],
  filters: [
    'workerType',
    'category',
    'gardenUnit',
    'section',
    'jobTask',
    'workerStatus',
    'employmentType',
    'gender',
    'district',
  ],
  files: [...WORKER_FILES],
  children: [
    { key: 'landDetails', model: 'workerLand', parentKey: 'workerId', schema: landSchema },
    { key: 'dependents', model: 'workerDependent', parentKey: 'workerId', schema: dependentSchema },
  ],
  orderBy: [{ workerId: 'asc' }],
  onCreate: async () => ({ workerId: (await nextWorkerIds())[0] }),
  onSave: workerDefaults,
  extend: (row) => ({
    workerName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' '),
    // RP1-79: the Management table's columns and the profile panel.
    workerTypeLabel: optionLabel('workerType', row.workerType),
    categoryLabel: optionLabel('category', row.category),
    gardenUnitLabel: optionLabel('gardenUnit', row.gardenUnit),
    sectionLabel: optionLabel('section', row.section),
    jobTaskLabel: optionLabel('jobTask', row.jobTask),
    workerStatusLabel: optionLabel('workerStatus', row.workerStatus),
    documents: DOCUMENTS.map((d) => ({
      id: d.id,
      name: d.name,
      icon: d.icon,
      status: given(row[d.field]) ? 'Uploaded' : 'Missing',
      url: d.file && given(row[d.field]) ? fileUrl(String(row[d.field])) : null,
    })),
  }),
  export: {
    fileName: 'workers',
    sheet: 'Workers',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Worker ID', value: (row) => row.workerId, width: 13 },
      { header: 'Worker Name', value: (row) => row.workerName, width: 26 },
      { header: "Father's Name", value: (row) => row.fathersName, width: 24 },
      { header: 'Category', value: (row) => row.jobTaskLabel, width: 18 },
      { header: 'Worker Type', value: (row) => row.workerTypeLabel, width: 14 },
      { header: 'Garden', value: (row) => row.gardenUnitLabel, width: 22 },
      { header: 'Section', value: (row) => row.sectionLabel, width: 12 },
      { header: 'Mobile', value: (row) => row.mobileNo, width: 16 },
      { header: 'Join Date', value: (row) => row.joinDate, width: 12 },
      { header: 'Status', value: (row) => row.workerStatusLabel, width: 12 },
    ],
  },
  check: (values) => Promise.resolve(checkWorkerDates(values)),
  /** Worker Management cards and overviews, for the same filters as the list. */
  summary: async (where) => {
    const rows = await db.worker.findMany({
      where,
      select: {
        id: true,
        workerId: true,
        firstName: true,
        middleName: true,
        lastName: true,
        workerType: true,
        jobTask: true,
        section: true,
        workerStatus: true,
        joinDate: true,
      },
    });
    const now = new Date();
    const total = rows.length;
    const count = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
    const active = count((r) => r.workerStatus === 'active');
    const onLeave = count((r) => r.workerStatus === 'on-leave');
    const inactive = count((r) => INACTIVE.includes(r.workerStatus));
    const newThisMonth = count((r) => inThisMonth(r.joinDate, now));
    const groups = (key: 'jobTask' | 'section' | 'workerType') =>
      countBy(rows, (r) => r[key]).map((g) => ({ ...g, name: optionLabel(key, g.value) ?? g.name }));
    const bySection = groups('section');
    const top = bySection[0]?.count ?? 0;
    return {
      // RP1-79: the page's cards, panels and attendance box, shaped like workerManagementData.js.
      summaryCards: [
        {
          id: 'total-workers',
          title: 'Total Workers',
          value: total,
          icon: 'users',
          iconColor: 'green',
          bgColor: 'green',
        },
        {
          id: 'active-workers',
          title: 'Active Workers',
          value: active,
          icon: 'user-check',
          iconColor: 'green',
          bgColor: 'green',
        },
        {
          id: 'on-leave',
          title: 'On Leave Today',
          value: onLeave,
          icon: 'calendar',
          iconColor: 'orange',
          bgColor: 'orange',
        },
        {
          id: 'inactive-workers',
          title: 'Inactive / Resigned',
          value: inactive,
          icon: 'user-x',
          iconColor: 'red',
          bgColor: 'red',
        },
        {
          id: 'new-this-month',
          title: 'New This Month',
          value: newThisMonth,
          icon: 'user-plus',
          iconColor: 'blue',
          bgColor: 'blue',
        },
      ],
      categoryWiseWorkers: groups('jobTask').map((g, i) => ({
        id: g.value,
        name: g.name,
        value: g.count,
        percentage: g.percentage,
        color: COLORS[i % COLORS.length],
      })),
      // The bars are scaled to the biggest section (100%), as in the prototype.
      sectionWiseDistribution: bySection.map((g) => ({
        id: g.value,
        name: g.name,
        value: g.count,
        percentage: pct(g.count, top),
      })),
      workerTypes: groups('workerType').map((g) => ({
        id: g.value,
        name: g.name,
        value: g.count,
        percentage: g.percentage,
        icon: g.value,
      })),
      // Attendance is on hold: present / absent are 0; leave counts workers whose status is On Leave.
      attendanceOverview: {
        title: 'Attendance Overview (This Month)',
        present: { value: 0, percentage: 0 },
        absent: { value: 0, percentage: 0 },
        leave: { value: onLeave, percentage: pct(onLeave, total) },
        buttonText: 'View Attendance Report',
      },
      totalWorkers: rows.length,
      activeWorkers: rows.filter((r) => r.workerStatus === 'active').length,
      onLeave: rows.filter((r) => r.workerStatus === 'on-leave').length,
      inactiveWorkers: rows.filter((r) => INACTIVE.includes(r.workerStatus)).length,
      newThisMonth: rows.filter((r) => inThisMonth(r.joinDate, now)).length,
      recentJoinees: [...rows]
        .sort((a, b) => b.joinDate.getTime() - a.joinDate.getTime())
        .slice(0, 5)
        .map((r) => ({
          id: r.id,
          workerId: r.workerId,
          workerName: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' '),
          joinDate: r.joinDate.toISOString().slice(0, 10),
        })),
    };
  },
  options: {
    path: 'workers',
    label: (row) => `${String(row.firstName)} ${String(row.lastName)} (${String(row.workerId)})`,
  },
});

/** RP1-79: the Worker Management filters' options (the form's values and labels). */
export const workerExtrasRouter = Router();
workerExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({
    gardens: WORKER_OPTIONS.gardenUnit,
    sections: WORKER_OPTIONS.section,
    categories: WORKER_OPTIONS.jobTask,
    workerTypes: WORKER_OPTIONS.workerType,
    statuses: WORKER_OPTIONS.workerStatus,
  });
});
docsPaths['/workers/filter-options'] = {
  get: {
    tags: ['Worker'],
    summary:
      'Worker Management filter options: gardens, sections, categories (job / task), workerTypes, statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
