import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import {
  bool,
  fileId,
  longText,
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
import { fileUrl } from '../files/service.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { bands, countBy, inThisMonth, label, pct, round2, yearsBetween } from './stats.js';

/**
 * RP1-22 C.1 Add New Employee: `AddNewEmployee.jsx`. The form is built from `addNewEmployeeData.js`, so the keys
 * are its field `name`s and the required ones are the fields marked `required`. Select fields keep the page's
 * option values. `employeeId` (EMP-0001) and `totalSalary` are worked out by the server. The Employee
 * Management page's cards and overviews come from `GET /employees/summary`.
 */
const phone = () => optPhone().refine((v) => v !== null, 'This field is required.');

const FILES = [
  'nationalIdFront',
  'nationalIdBack',
  'passportPhoto',
  'educationalCertificate',
  'experienceCertificate',
  'otherDocument',
  'employeePhoto',
  'employeeFace',
  'rightThumb',
  'leftThumb',
] as const;

const employeeSchema = z.object({
  // Basic information
  employeeType: option(),
  title: option(),
  firstName: text(),
  middleName: optText(),
  lastName: text(),
  fatherName: text(),
  motherName: text(),
  dateOfBirth: reqDate(),
  gender: option(),
  bloodGroup: optOption(),
  maritalStatus: optOption(),
  nationality: option(),
  religion: optOption(),
  tinNo: optText(60),
  nationalIdNo: optText(60),
  passportNo: optText(60),
  drivingLicenseNo: optText(60),
  // Employment
  department: option(),
  designation: option(),
  jobGrade: optOption(),
  employmentDate: reqDate(),
  probationEndDate: optDate(),
  confirmationDate: optDate(),
  employmentType: option(),
  workingLocation: option(),
  jobNature: optOption(),
  reportingTo: option(),
  numberOfDependents: optInt(),
  employeeStatus: option(),
  // Contact
  mobileNo: phone(),
  email: optEmail(),
  personalEmail: optEmail(),
  presentAddress: text(5000),
  permanentAddress: text(5000),
  sameAsPermanentAddress: bool(),
  district: option(),
  upazila: option(),
  postalCode: optText(20),
  // Salary and payroll
  basicSalary: num(),
  houseRent: optNum(),
  medicalAllowance: optNum(),
  conveyance: optNum(),
  otherAllowance: optNum(),
  paymentMethod: option(),
  bankName: option(),
  accountNo: text(60),
  remarks: longText(),
  // Documents, photo and biometrics
  ...Object.fromEntries(FILES.map((f) => [f, fileId()])),
  // Emergency contact
  emergencyContactName: text(),
  emergencyRelation: option(),
  emergencyMobile: phone(),
  emergencyAlternateMobile: optPhone(),
  emergencyAddress: longText(),
  // Nominee
  nomineeName: text(),
  nomineeRelation: option(),
  nomineeDateOfBirth: optDate(),
  nomineeNationalId: optText(60),
  nomineeMobile: optPhone(),
  nomineeAddress: longText(),
});

/**
 * RP1-78 J.1 Employee Management: the Add New Employee form's option lists (`addNewEmployeeData.js`), so the
 * Management page's filters and columns use the values the form saves.
 */
const opts = (pairs: [string, string][]) =>
  pairs.map(([value, text], i) => ({ id: i + 1, value, label: text }));
export const EMPLOYEE_OPTIONS = {
  department: opts([
    ['hr', 'HR & Workforce Management'],
    ['accounts', 'Accounts & Finance'],
    ['estate', 'Estate Management'],
    ['operations', 'Operations'],
  ]),
  designation: opts([
    ['manager', 'Manager'],
    ['assistant-manager', 'Assistant Manager'],
    ['officer', 'Officer'],
    ['executive', 'Executive'],
  ]),
  /** The page's "Employment Type" column is the form's Employee Type. */
  employeeType: opts([
    ['permanent', 'Permanent'],
    ['probationary', 'Probationary'],
    ['contractual', 'Contractual'],
    ['temporary', 'Temporary'],
  ]),
  employeeStatus: opts([
    ['active', 'Active'],
    ['inactive', 'Inactive'],
    ['on-leave', 'On Leave'],
  ]),
};
const optionLabel = (key: keyof typeof EMPLOYEE_OPTIONS, value: unknown) =>
  typeof value === 'string'
    ? (EMPLOYEE_OPTIONS[key].find((o) => o.value === value)?.label ?? label(value))
    : null;
const TITLES: Record<string, string> = { mr: 'Mr.', mrs: 'Mrs.', ms: 'Ms.' };
const COLORS = ['#166534', '#2563eb', '#a855f7', '#f59e0b', '#ef4444', '#14b8a6', '#64748b', '#ec4899'];

/** `?joinFrom=` / `?joinTo=` (YYYY-MM-DD) on the employment date; a date that does not parse is ignored. */
const joinDate = (op: 'gte' | 'lte') => (v: string) => {
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? {} : { employmentDate: { [op]: d } };
};

const firstOfMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

async function nextEmployeeId(): Promise<string> {
  const last = await db.employee.findFirst({
    where: { employeeId: { startsWith: 'EMP-' } },
    orderBy: { employeeId: 'desc' },
    select: { employeeId: true },
  });
  const n = last ? Number.parseInt(last.employeeId.slice(4), 10) + 1 : 1;
  return `EMP-${String(n).padStart(4, '0')}`;
}

export const employeesRouter = defineResource('/employees', {
  name: 'employee',
  label: 'Employee',
  module: 'hr',
  page: 'Employee',
  describe: (r) => show(r.employeeId ?? 'New', `(${show(r.firstName, r.middleName, r.lastName)})`),
  model: 'employee',
  schema: employeeSchema,
  search: ['employeeId', 'firstName', 'middleName', 'lastName', 'email', 'mobileNo', 'nationalIdNo'],
  filters: [
    'employeeType',
    'department',
    'designation',
    'employmentType',
    'employeeStatus',
    'workingLocation',
    'gender',
    'district',
    { name: 'joinFrom', where: joinDate('gte') },
    { name: 'joinTo', where: joinDate('lte') },
  ],
  files: [...FILES],
  unique: ['nationalIdNo', 'passportNo', 'email'],
  orderBy: [{ employeeId: 'asc' }],
  onCreate: async () => ({ employeeId: await nextEmployeeId() }),
  onSave: (values) => ({
    numberOfDependents: values.numberOfDependents ?? 0,
    sameAsPermanentAddress: values.sameAsPermanentAddress ?? false,
    totalSalary: round2(
      ['basicSalary', 'houseRent', 'medicalAllowance', 'conveyance', 'otherAllowance'].reduce(
        (sum, key) => sum + Number(values[key] ?? 0),
        0,
      ),
    ),
  }),
  extend: (row) => {
    const employeeName = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ');
    const title = typeof row.title === 'string' ? TITLES[row.title] : undefined;
    return {
      employeeName,
      // RP1-78: the Management table's columns.
      fullName: title ? `${title} ${employeeName}` : employeeName,
      departmentLabel: optionLabel('department', row.department),
      designationLabel: optionLabel('designation', row.designation),
      employeeTypeLabel: optionLabel('employeeType', row.employeeType),
      employeeStatusLabel: optionLabel('employeeStatus', row.employeeStatus),
      joinDate: row.employmentDate,
    };
  },
  export: {
    fileName: 'employees',
    sheet: 'Employees',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Employee ID', value: (row) => row.employeeId, width: 14 },
      { header: 'Employee Name', value: (row) => row.fullName, width: 30 },
      { header: 'Department', value: (row) => row.departmentLabel, width: 26 },
      { header: 'Designation', value: (row) => row.designationLabel, width: 20 },
      { header: 'Employment Type', value: (row) => row.employeeTypeLabel, width: 18 },
      { header: 'Status', value: (row) => row.employeeStatusLabel, width: 12 },
      { header: 'Join Date', value: (row) => row.joinDate, width: 12 },
      { header: 'Mobile', value: (row) => row.mobileNo, width: 16 },
      { header: 'Email', value: (row) => row.email, width: 28 },
    ],
  },
  check: (values): Promise<Record<string, string>> => {
    const fields: Record<string, string> = {};
    const today = new Date();
    const date = (key: string) => (values[key] instanceof Date ? values[key] : null);
    const employed = date('employmentDate');
    if (date('dateOfBirth') && date('dateOfBirth')! > today)
      fields.dateOfBirth = 'Date of birth cannot be in the future.';
    if (date('nomineeDateOfBirth') && date('nomineeDateOfBirth')! > today)
      fields.nomineeDateOfBirth = 'Date of birth cannot be in the future.';
    if (employed && date('dateOfBirth') && date('dateOfBirth')! >= employed)
      fields.dateOfBirth ??= 'Date of birth must be before the employment date.';
    for (const key of ['probationEndDate', 'confirmationDate'])
      if (employed && date(key) && date(key)! < employed)
        fields[key] = 'Must be on or after the employment date.';
    return Promise.resolve(fields);
  },
  /** Employee Management cards and overviews, for the same filters as the list. */
  summary: async (where) => {
    const rows = await db.employee.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        title: true,
        firstName: true,
        middleName: true,
        lastName: true,
        designation: true,
        employeePhoto: true,
        department: true,
        employmentType: true,
        employeeType: true,
        employeeStatus: true,
        gender: true,
        dateOfBirth: true,
        employmentDate: true,
      },
    });
    const now = new Date();
    const total = rows.length;
    const status = (s: string) => rows.filter((r) => r.employeeStatus === s).length;
    const newThisMonth = rows.filter((r) => inThisMonth(r.employmentDate, now)).length;
    // RP1-78: exits = employees now Inactive whose status was changed to Inactive this month (edit log).
    const inactiveIds = rows.filter((r) => r.employeeStatus === 'inactive').map((r) => r.id);
    const exits = inactiveIds.length
      ? await db.recordHistory.findMany({
          where: {
            resource: 'employee',
            action: 'update',
            recordId: { in: inactiveIds },
            changedAt: { gte: firstOfMonth(now) },
            newData: { path: '$.employeeStatus', equals: 'inactive' },
            NOT: { oldData: { path: '$.employeeStatus', equals: 'inactive' } },
          },
          select: { recordId: true },
          distinct: ['recordId'],
        })
      : [];
    const exitsThisMonth = exits.length;
    const tenure = total
      ? Math.round(
          (rows.reduce((s, r) => s + Math.max(0, now.getTime() - r.employmentDate.getTime()), 0) /
            total /
            31_557_600_000) *
            10,
        ) / 10
      : 0;
    const overview = (key: 'department' | 'employeeType', title: string) => ({
      title,
      totalEmployees: total,
      data: countBy(rows, (r) => r[key]).map((d, i) => ({
        id: d.id,
        value: d.value,
        name: optionLabel(key, d.value) ?? d.name,
        count: d.count,
        percentage: d.percentage,
        color: COLORS[i % COLORS.length],
      })),
    });
    const name = (r: (typeof rows)[number]) =>
      [TITLES[r.title] ?? '', r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ');
    const share = (n: number) => `${pct(n, total)}% of Total`;
    return {
      // The page's six cards, shaped like `summaryCards` in employeeManagementData.js.
      summaryCards: [
        {
          id: 'total-employees',
          key: 'totalEmployees',
          title: 'Total Employees',
          value: total,
          subtitle: 'All Employees',
          unit: 'employees',
          colorKey: 'green',
        },
        {
          id: 'active-employees',
          key: 'activeEmployees',
          title: 'Active Employees',
          value: status('active'),
          subtitle: share(status('active')),
          unit: 'employees',
          colorKey: 'blue',
        },
        {
          id: 'on-leave',
          key: 'onLeave',
          title: 'On Leave',
          value: status('on-leave'),
          subtitle: share(status('on-leave')),
          unit: 'employees',
          colorKey: 'orange',
        },
        {
          id: 'new-this-month',
          key: 'newThisMonth',
          title: 'New This Month',
          value: newThisMonth,
          subtitle: 'This Period',
          unit: 'employees',
          colorKey: 'purple',
        },
        {
          id: 'exits-this-month',
          key: 'exitsThisMonth',
          title: 'Exits This Month',
          value: exitsThisMonth,
          subtitle: 'This Period',
          unit: 'employees',
          colorKey: 'red',
        },
        {
          id: 'average-tenure',
          key: 'averageTenure',
          title: 'Avg. Tenure',
          value: tenure,
          subtitle: 'All Employees',
          unit: 'years',
          colorKey: 'teal',
        },
      ],
      exitsThisMonth,
      averageTenure: tenure,
      departmentOverview: overview('department', 'Employees by Department'),
      employeeTypeOverview: overview('employeeType', 'Employees by Employment Type'),
      recentJoiners: [...rows]
        .sort((a, b) => b.employmentDate.getTime() - a.employmentDate.getTime())
        .slice(0, 5)
        .map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          fullName: name(r),
          designation: optionLabel('designation', r.designation),
          joinDate: r.employmentDate.toISOString().slice(0, 10),
          avatarUrl: r.employeePhoto ? fileUrl(r.employeePhoto) : null,
        })),
      // No expiry dates are kept for employee documents yet, so every count is 0.
      documentExpiryAlerts: {
        title: 'Document Expiry Alerts',
        data: [
          { id: 'id-card', label: 'ID Card', count: 0, severity: 'danger' },
          { id: 'work-permit', label: 'Work Permit', count: 0, severity: 'warning' },
          { id: 'medical-fitness', label: 'Medical Fitness', count: 0, severity: 'info' },
          { id: 'others', label: 'Others', count: 0, severity: 'neutral' },
        ],
        action: { label: 'View All Alerts' },
      },
      totalEmployees: total,
      activeEmployees: status('active'),
      onLeave: status('on-leave'),
      inactiveEmployees: status('inactive'),
      newThisMonth,
      // Kept as before (counts by value), for anything already using them.
      employmentTypeOverview: countBy(rows, (r) => r.employeeType),
      employmentBasis: countBy(rows, (r) => r.employmentType),
      genderDistribution: countBy(rows, (r) => r.gender),
      ageGroupDistribution: bands(rows, (r) => yearsBetween(r.dateOfBirth, now), [
        ['< 25', 0, 25],
        ['25 - 35', 25, 35],
        ['35 - 45', 35, 45],
        ['45 - 55', 45, 55],
        ['55+', 55, 200],
      ]),
      lengthOfService: bands(rows, (r) => (now.getTime() - r.employmentDate.getTime()) / 31_557_600_000, [
        ['0 - 1 Year', -1, 1],
        ['1 - 3 Years', 1, 3],
        ['3 - 5 Years', 3, 5],
        ['5 - 10 Years', 5, 10],
        ['10+ Years', 10, 200],
      ]),
    };
  },
  options: {
    path: 'employees',
    label: (row) => `${String(row.firstName)} ${String(row.lastName)} (${String(row.employeeId)})`,
  },
});

/** RP1-78: the Employee Management filters' options (the form's values and labels). */
export const employeeExtrasRouter = Router();
employeeExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({
    departments: EMPLOYEE_OPTIONS.department,
    designations: EMPLOYEE_OPTIONS.designation,
    employmentTypes: EMPLOYEE_OPTIONS.employeeType,
    statuses: EMPLOYEE_OPTIONS.employeeStatus,
  });
});
docsPaths['/employees/filter-options'] = {
  get: {
    tags: ['Employee'],
    summary: 'Employee Management filter options: departments, designations, employmentTypes, statuses',
    responses: {
      '200': {
        description: '{ departments, designations, employmentTypes, statuses }: [{ id, value, label }]',
      },
    },
  },
};
