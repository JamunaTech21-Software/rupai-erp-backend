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
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { countBy, inThisMonth } from './stats.js';

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

export const workersRouter = defineResource('/workers', {
  name: 'worker',
  label: 'Worker',
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
  }),
  check: (values) => Promise.resolve(checkWorkerDates(values)),
  /** Worker Management cards and overviews, for the same filters as the list. */
  summary: async (where) => {
    const rows = await db.worker.findMany({
      where,
      select: {
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
    return {
      totalWorkers: rows.length,
      activeWorkers: rows.filter((r) => r.workerStatus === 'active').length,
      onLeave: rows.filter((r) => r.workerStatus === 'on-leave').length,
      inactiveWorkers: rows.filter((r) => INACTIVE.includes(r.workerStatus)).length,
      newThisMonth: rows.filter((r) => inThisMonth(r.joinDate, now)).length,
      categoryWiseWorkers: countBy(rows, (r) => r.jobTask),
      sectionWiseDistribution: countBy(rows, (r) => r.section),
      workerTypes: countBy(rows, (r) => r.workerType),
      recentJoinees: [...rows]
        .sort((a, b) => b.joinDate.getTime() - a.joinDate.getTime())
        .slice(0, 5)
        .map((r) => ({
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
