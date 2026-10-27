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
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { bands, countBy, inThisMonth, round2, yearsBetween } from './stats.js';

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
  extend: (row) => ({
    employeeName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(' '),
  }),
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
    return {
      totalEmployees: total,
      activeEmployees: status('active'),
      onLeave: status('on-leave'),
      inactiveEmployees: status('inactive'),
      newThisMonth,
      departmentOverview: countBy(rows, (r) => r.department),
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
