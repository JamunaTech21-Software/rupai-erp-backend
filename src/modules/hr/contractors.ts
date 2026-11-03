import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
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
import { show } from '../../lib/approval.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { fileUrl } from '../files/service.js';
import { countBy, inThisMonth, label } from './stats.js';

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

/**
 * RP1-80 J.3 Contractor Management: the Add New Contractor form's option lists (`addNewContractorData.js`).
 * The filters list these plus any other value already saved, so every saved contractor can be found.
 */
const opts = (pairs: [string, string][]) => pairs.map(([value, text]) => ({ value, label: text }));
const CONTRACTOR_OPTIONS = {
  contractorType: opts([
    ['individual', 'Individual'],
    ['company', 'Company'],
    ['supplier', 'Supplier'],
  ]),
  tradeCategory: opts([
    ['construction', 'Construction'],
    ['electrical', 'Electrical'],
    ['mechanical', 'Mechanical'],
    ['transport', 'Transport'],
  ]),
  contractStatus: opts([
    ['active', 'Active'],
    ['pending', 'Pending'],
    ['completed', 'Completed'],
    ['terminated', 'Terminated'],
  ]),
  workLocation: opts([
    ['estate', 'Estate'],
    ['factory', 'Factory'],
    ['office', 'Office'],
    ['field', 'Field / Block'],
  ]),
};
type OptionKey = keyof typeof CONTRACTOR_OPTIONS;
const optionLabel = (key: OptionKey, value: unknown) =>
  typeof value === 'string'
    ? (CONTRACTOR_OPTIONS[key].find((o) => o.value === value)?.label ?? label(value))
    : null;

/** The profile's Documents tab (the prototype's names), Uploaded / Missing from the file fields. */
const DOCUMENTS: [string, string][] = [
  ['Trade License', 'tradeLicense'],
  ['TIN Certificate', 'tinCertificate'],
  ['VAT Certificate', 'vatCertificate'],
  ['Bank Document', 'bankDocument'],
  ['Contract Agreement', 'contractAgreement'],
  ['Insurance', 'insurance'],
  ['Work Permit', 'workPermit'],
  ['Other Document', 'otherDocument1'],
];
const given = (v: unknown) => typeof v === 'string' && v.trim() !== '';
/** Quality rating out of 5 and compliance in %, from the form's choices. */
const RATING: Record<string, number> = { excellent: 5, good: 4, average: 3, poor: 2 };
const COMPLIANCE: Record<string, number> = { compliant: 100, 'partially-compliant': 50, 'non-compliant': 0 };

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
  module: 'hr',
  page: 'Contractor',
  describe: (r) => show(r.contractorId ?? 'New', `(${String(r.contractorName)})`),
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
    const docs = DOCUMENTS.map(([name, field], i) => ({
      id: i + 1,
      name,
      status: given(row[field]) ? 'Uploaded' : 'Missing',
      url: given(row[field]) ? fileUrl(String(row[field])) : null,
    }));
    // The second "other document" field shows as one more row only when it is filled in.
    if (given(row.otherDocument2))
      docs.push({
        id: 9,
        name: 'Other Document 2',
        status: 'Uploaded',
        url: fileUrl(String(row.otherDocument2)),
      });
    return {
      daysLeft: days,
      expiryStatus: days === null ? null : expiry(days),
      // RP1-80: the Management table's labels and the profile panel.
      contractorTypeLabel: optionLabel('contractorType', row.contractorType),
      tradeCategoryLabel: optionLabel('tradeCategory', row.tradeCategory),
      contractStatusLabel: optionLabel('contractStatus', row.contractStatus),
      workLocationLabel: optionLabel('workLocation', row.workLocation),
      documents: docs,
      performance: {
        // No work orders are kept yet, so on-time completion is 0.
        onTimeWorkCompletion: 0,
        qualityRating: typeof row.qualityRating === 'string' ? (RATING[row.qualityRating] ?? null) : null,
        compliance:
          typeof row.safetyCompliance === 'string' ? (COMPLIANCE[row.safetyCompliance] ?? null) : null,
      },
    };
  },
  export: {
    fileName: 'contractors',
    sheet: 'Contractors',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Contractor ID', value: (row) => row.contractorId, width: 14 },
      { header: 'Contractor Name', value: (row) => row.contractorName, width: 30 },
      { header: 'Type', value: (row) => row.contractorTypeLabel, width: 14 },
      { header: 'Trade', value: (row) => row.tradeCategoryLabel, width: 18 },
      { header: 'Mobile', value: (row) => row.mobileNo, width: 16 },
      { header: 'Email', value: (row) => row.email, width: 28 },
      { header: 'Working Location', value: (row) => row.workLocationLabel, width: 18 },
      { header: 'Status', value: (row) => row.contractStatusLabel, width: 12 },
      { header: 'Contract Start', value: (row) => row.contractStartDate, width: 14 },
      { header: 'Contract End', value: (row) => row.contractEndDate, width: 14 },
      { header: 'Contract Value (BDT)', value: (row) => row.contractValue, width: 20, numFmt: '#,##0.00' },
    ],
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
    const total = rows.length;
    const expiring = alerts.filter((a) => a.days >= 0 && a.days <= 30).length;
    const newThisMonth = rows.filter((r) => inThisMonth(r.createdAt)).length;
    const value = rows.reduce((s, r) => s + Number(r.contractValue ?? 0), 0);
    const groups = (key: 'contractorType' | 'tradeCategory' | 'contractStatus') =>
      countBy(rows, (r) => r[key]).map((g) => ({
        id: g.value,
        name: optionLabel(key, g.value) ?? g.name,
        value: g.count,
        percentage: g.percentage,
      }));
    return {
      // RP1-80: the page's cards and panels, shaped like contractorManagementData.js.
      summaryCards: [
        { id: 1, title: 'Total Contractors', value: total, type: 'total', badge: 'Total' },
        { id: 2, title: 'Active Contractors', value: active.length, type: 'active', badge: 'Active' },
        {
          id: 3,
          title: 'Inactive Contractors',
          value: total - active.length,
          type: 'inactive',
          badge: 'Inactive',
        },
        { id: 4, title: 'Contracts Expiring', value: expiring, type: 'expiring', badge: '30 Days' },
        { id: 5, title: 'New This Month', value: newThisMonth, type: 'new', badge: 'New' },
        { id: 6, title: 'Total Contract Value', value, type: 'value', badge: 'Value', currency: '৳' },
      ],
      totalContractors: rows.length,
      activeContractors: active.length,
      inactiveContractors: rows.length - active.length,
      contractsExpiring: alerts.filter((a) => a.days >= 0 && a.days <= 30).length,
      newThisMonth: rows.filter((r) => inThisMonth(r.createdAt)).length,
      totalContractValue: rows.reduce((s, r) => s + Number(r.contractValue ?? 0), 0),
      contractorTypeWise: groups('contractorType'),
      tradeWorkWise: groups('tradeCategory').map(({ id, name, value: n }) => ({ id, name, value: n })),
      contractStatus: groups('contractStatus'),
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
        // The prototype's words.
        status: days < 0 ? 'Expired' : days <= 30 ? 'Expiring Soon' : 'Safe',
      })),
    };
  },
  options: {
    path: 'contractors',
    label: (row) => `${String(row.contractorName)} (${String(row.contractorId)})`,
  },
});

/** RP1-80: the Contractor Management filters' options: the form's values, plus any other saved value. */
export const contractorExtrasRouter = Router();
contractorExtrasRouter.get('/filter-options', async (_req, res) => {
  const saved = await db.contractor.findMany({
    where: { deletedAt: null },
    select: { contractorType: true, tradeCategory: true, contractStatus: true, workLocation: true },
  });
  const list = (key: OptionKey) => {
    const known = CONTRACTOR_OPTIONS[key];
    const extra = [...new Set(saved.map((r) => r[key]))]
      .filter((v) => v && !known.some((o) => o.value === v))
      .sort()
      .map((v) => ({ value: v, label: label(v) }));
    return [...known, ...extra].map((o, i) => ({ id: i + 1, ...o }));
  };
  res.json({
    contractorTypes: list('contractorType'),
    tradeCategories: list('tradeCategory'),
    statuses: list('contractStatus'),
    locations: list('workLocation'),
  });
});
docsPaths['/contractors/filter-options'] = {
  get: {
    tags: ['Contractor'],
    summary: 'Contractor Management filter options: contractorTypes, tradeCategories, statuses, locations',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
