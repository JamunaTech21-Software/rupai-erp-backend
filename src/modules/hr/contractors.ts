import { db } from '../../lib/db.js';
import {
  fileId,
  longText,
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
 * RP1-25 C.4 Add New Contractor: `AddNewContractor.jsx`. The form is built from `addNewContractorData.js`, so the
 * keys are its field `name`s and the required ones are the fields marked `required`. Select fields keep the
 * page's option values. `contractorId` (CON-1001) is worked out by the server. The Contractor Management page's
 * cards and overviews come from `GET /contractors/summary`.
 */
const phone = () => optPhone().refine((v) => v !== null, 'This field is required.');

const FILES = [
  'contractorPhoto',
  'companyLogo',
  'tradeLicense',
  'tinCertificate',
  'vatCertificate',
  'bankDocument',
  'contractAgreement',
  'insurance',
  'workPermit',
  'otherDocument1',
  'otherDocument2',
] as const;

const contractorSchema = z.object({
  // Basic information
  contractorType: option(),
  tradeCategory: option(),
  contractorName: text(),
  shortName: optText(60),
  legalStatus: optOption(),
  registrationType: optText(120),
  contractorSince: optDate(),
  description: longText(),
  // Contact
  mobileNo: phone(),
  alternateMobile: optPhone(),
  email: optEmail(),
  presentAddress: text(5000),
  presentDistrict: option(),
  presentUpazila: option(),
  presentPostalCode: optText(20),
  permanentAddress: longText(),
  permanentDistrict: optOption(),
  permanentUpazila: optOption(),
  permanentPostalCode: optText(20),
  // Contact person
  contactPersonName: text(),
  designation: optText(120),
  contactPersonMobile: phone(),
  contactPersonEmail: optEmail(),
  // Business registration
  nationalIdNo: optText(60),
  tradeLicenseNo: text(60),
  tradeLicenseExpiry: optDate(),
  binNo: optText(60),
  tinNo: optText(60),
  vatRegistrationNo: optText(60),
  companyRegistrationNo: optText(60),
  registrationDate: optDate(),
  renewalDate: optDate(),
  // Contract
  contractReferenceNo: text(60),
  contractStartDate: reqDate(),
  contractEndDate: reqDate(),
  contractDuration: option(),
  paymentTerms: option(),
  contractValue: optNum(),
  workLocation: option(),
  reportingTo: option(),
  contractStatus: option(),
  // Banking
  bankName: option(),
  branchName: text(),
  accountName: text(),
  accountNo: text(60),
  routingNo: optText(20),
  mobileBanking: optText(60),
  // Images and documents
  ...Object.fromEntries(FILES.map((f) => [f, fileId()])),
  // Capacity
  numberOfWorkers: optInt(),
  equipmentToolsOwned: longText(),
  yearsOfExperience: optInt(),
  safetyCompliance: optOption(),
  qualityRating: optOption(),
  remarks: longText(),
  // Emergency contact
  emergencyContactName: text(),
  emergencyRelation: option(),
  emergencyMobile: phone(),
  emergencyAlternateMobile: optPhone(),
  emergencyAddress: longText(),
});

const DAY = 86_400_000;
const startOfToday = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const daysLeft = (end: Date) => Math.round((end.getTime() - startOfToday().getTime()) / DAY);
const expiry = (days: number) => (days < 0 ? 'Expired' : days <= 30 ? 'Expiring' : 'Safe');

async function nextContractorId(): Promise<string> {
  const last = await db.contractor.findFirst({
    where: { contractorId: { startsWith: 'CON-' } },
    orderBy: { contractorId: 'desc' },
    select: { contractorId: true },
  });
  const n = last ? Number.parseInt(last.contractorId.slice(4), 10) + 1 : 1001;
  return `CON-${n}`;
}

export const contractorsRouter = defineResource('/contractors', {
  name: 'contractor',
  label: 'Contractor',
  model: 'contractor',
  schema: contractorSchema,
  search: [
    'contractorId',
    'contractorName',
    'shortName',
    'mobileNo',
    'email',
    'contactPersonName',
    'tradeLicenseNo',
  ],
  filters: [
    'contractorType',
    'tradeCategory',
    'contractStatus',
    'workLocation',
    'paymentTerms',
    'presentDistrict',
  ],
  files: [...FILES],
  unique: ['tradeLicenseNo', 'contractReferenceNo'],
  orderBy: [{ contractorId: 'asc' }],
  onCreate: async () => ({ contractorId: await nextContractorId() }),
  extend: (row) => {
    const value = row.contractEndDate;
    const end = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
    const days = end && !Number.isNaN(end.getTime()) ? daysLeft(end) : null;
    return { daysLeft: days, expiryStatus: days === null ? null : expiry(days) };
  },
  check: (values) => {
    const fields: Record<string, string> = {};
    const date = (key: string) => (values[key] instanceof Date ? values[key] : null);
    const start = date('contractStartDate');
    const end = date('contractEndDate');
    if (start && end && end < start)
      fields.contractEndDate = 'Contract end date must be after the start date.';
    const since = date('contractorSince');
    if (since && since > new Date()) fields.contractorSince = 'Cannot be in the future.';
    const registered = date('registrationDate');
    const renewal = date('renewalDate');
    if (registered && renewal && renewal < registered)
      fields.renewalDate = 'Must be on or after the registration date.';
    return Promise.resolve(fields);
  },
  /** Contractor Management cards and overviews, for the same filters as the list. */
  summary: async (where) => {
    const rows = await db.contractor.findMany({
      where,
      select: {
        contractorId: true,
        contractorName: true,
        contractorType: true,
        tradeCategory: true,
        contractStatus: true,
        contractEndDate: true,
        contractValue: true,
        createdAt: true,
      },
    });
    const active = rows.filter((r) => r.contractStatus === 'active');
    const alerts = active
      .map((r) => ({ r, days: daysLeft(r.contractEndDate) }))
      .sort((a, b) => a.days - b.days);
    return {
      totalContractors: rows.length,
      activeContractors: active.length,
      inactiveContractors: rows.length - active.length,
      contractsExpiring: alerts.filter((a) => a.days >= 0 && a.days <= 30).length,
      newThisMonth: rows.filter((r) => inThisMonth(r.createdAt)).length,
      totalContractValue: rows.reduce((s, r) => s + Number(r.contractValue ?? 0), 0),
      contractorTypeWise: countBy(rows, (r) => r.contractorType),
      tradeWorkWise: countBy(rows, (r) => r.tradeCategory),
      contractStatus: countBy(rows, (r) => r.contractStatus),
      topContractors: [...rows]
        .sort((a, b) => Number(b.contractValue ?? 0) - Number(a.contractValue ?? 0))
        .slice(0, 5)
        .map((r) => ({
          contractorId: r.contractorId,
          name: r.contractorName,
          contractValue: Number(r.contractValue ?? 0),
        })),
      expiryAlerts: alerts.slice(0, 5).map(({ r, days }) => ({
        contractorId: r.contractorId,
        contractorName: r.contractorName,
        endDate: r.contractEndDate.toISOString().slice(0, 10),
        daysLeft: days,
        status: expiry(days),
      })),
    };
  },
  options: {
    path: 'contractors',
    label: (row) => `${String(row.contractorName)} (${String(row.contractorId)})`,
  },
});
