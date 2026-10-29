import { db } from '../../lib/db.js';
import {
  fileId,
  longText,
  num,
  oneOf,
  optCoord,
  optDate,
  optEmail,
  optNum,
  optOneOf,
  optRef,
  optText,
  polygon,
  ref,
  reqDate,
  text,
} from '../../lib/fields.js';
import { banglaYear } from '../../lib/bangla.js';
import { areaAcres, centre, isPolygon, perimeterKm } from '../../lib/geo.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-16 A.5 Land & Lease Management: `LandAndLeaseManagement.jsx`. The Add Land / Lease form (its
 * `register(...)` names), then the lease payments and documents (`paymentFormData`, `documentFormData`),
 * each linked to the land record by `landLeaseId`. Options are the data file's values.
 */
export const LAND_LEASE_TYPES = ['leased_in', 'leased_out', 'owned', 'disputed'] as const;
export const LAND_CATEGORIES = [
  'tea_garden_land',
  'factory_land',
  'office_area',
  'residential_area',
  'water_body',
  'road',
  'nursery',
] as const;
export const RECORD_TYPES = ['cs_record', 'sa_record', 'rs_record', 'bs_record'] as const;
export const LAND_STATUSES = ['active', 'inactive', 'under_process', 'expired'] as const;
export const PAYMENT_STATUSES = ['Paid', 'Pending', 'Overdue'] as const;
export const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Online Payment'] as const;
export const DOCUMENT_TYPES = [
  'Lease Deed',
  'Khatian',
  'CS Record',
  'SA Record',
  'RS Record',
  'BS Record',
  'Map',
  'NOC',
  'Other',
] as const;

const landSchema = z.object({
  estate: ref(),
  landLeaseType: oneOf(LAND_LEASE_TYPES),
  landCategory: oneOf(LAND_CATEGORIES),
  landLeaseName: text(),
  surveyNo: text(100),
  plotNo: text(100),
  /** RP1-54: a mouza of this estate (`/options/mouzas?estate=`). */
  mouza: optRef(),
  jlNo: optText(100),
  recordType: optOneOf(RECORD_TYPES),
  // Owner / Lessor Information
  ownerName: text(),
  fatherOrCompanyName: optText(),
  ownerMobile: optText(40),
  ownerEmail: optEmail(),
  ownerNidTin: optText(60),
  ownerAddress: longText(),
  ownershipRemarks: longText(),
  // Area & Status
  totalArea: num(),
  usableArea: optNum(),
  nonUsableArea: optNum(),
  landStatus: oneOf(LAND_STATUSES),
  // Lease Period
  acquisitionDate: reqDate(),
  startDate: reqDate(),
  endDate: reqDate(),
  leaseTerm: optText(60),
  rentAmount: optNum(),
  rentPerAcre: optNum(),
  // Location
  location: optText(),
  gpsArea: optText(60),
  latitude: optCoord(),
  longitude: optCoord(),
  purpose: longText(),
  /** Land boundary for the map: [[latitude, longitude], …]. */
  polygon: polygon(),
});

const TYPE_TOTALS = {
  ownedLand: 'owned',
  leasedInLand: 'leased_in',
  leasedOutLand: 'leased_out',
  disputedLand: 'disputed',
} as const;

export const landRecordsRouter = defineResource('/land-records', {
  name: 'landRecord',
  label: 'Land / lease record',
  model: 'landRecord',
  schema: landSchema,
  search: ['landLeaseName', 'plotNo', 'surveyNo', 'ownerName'],
  // The page's filter keys are estate, landLeaseType, landCategory and status (= landStatus).
  filters: [
    'estate',
    'landLeaseType',
    'landCategory',
    'landStatus',
    'mouza',
    { name: 'status', where: (landStatus) => ({ landStatus }) },
  ],
  refs: {
    estate: { model: 'estate', label: 'estateName' },
    mouza: { model: 'mouza', label: 'mouzaName' },
  },
  orderBy: { landLeaseName: 'asc' },
  /** RP1-54: with a drawn boundary and no GPS area typed, the GPS area is the boundary's area. */
  onSave: (values) =>
    values.gpsArea === null && isPolygon(values.polygon)
      ? { gpsArea: `${areaAcres(values.polygon).toFixed(2)} Acre` }
      : {},
  check: async (values) => {
    const fields: Record<string, string> = {};
    if (
      values.endDate instanceof Date &&
      values.startDate instanceof Date &&
      values.endDate < values.startDate
    )
      fields.endDate = 'End Date cannot be before Start Date.';
    const usable = Number(values.usableArea ?? 0) + Number(values.nonUsableArea ?? 0);
    if (usable > Number(values.totalArea))
      fields.usableArea = 'Usable and non-usable area together cannot be more than the total area.';
    if (typeof values.mouza === 'string') {
      const mouza = await db.mouza.findFirst({
        where: { id: values.mouza, deletedAt: null },
        select: { estate: true },
      });
      if (mouza && mouza.estate !== values.estate) fields.mouza = 'Pick a mouza of the selected estate.';
    }
    return fields;
  },
  /** The map panel (`mapInformation`, `landBoundary`), from the boundary or the latitude / longitude. */
  extend: (row) => {
    const boundary = isPolygon(row.polygon) ? row.polygon : null;
    const point = boundary
      ? centre(boundary)
      : row.latitude !== null && row.longitude !== null
        ? [Number(row.latitude), Number(row.longitude)]
        : null;
    return {
      map: {
        totalArea: row.totalArea,
        perimeter: boundary ? perimeterKm(boundary) : null,
        /** RP1-54: acres inside the drawn boundary. */
        polygonArea: boundary ? areaAcres(boundary) : null,
        latitude: point?.[0] ?? null,
        longitude: point?.[1] ?? null,
        landBoundary: boundary ?? [],
      },
    };
  },
  /** The five summary cards (`statistics`: total, owned, leased in, leased out, disputed acres). */
  summary: async (where) => {
    const [all, ...byType] = await Promise.all([
      db.landRecord.aggregate({ where, _sum: { totalArea: true } }),
      ...Object.values(TYPE_TOTALS).map((landLeaseType) =>
        db.landRecord.aggregate({ where: { ...where, landLeaseType }, _sum: { totalArea: true } }),
      ),
    ]);
    const statistics = {
      totalLand: Number(all._sum.totalArea ?? 0),
      ...Object.fromEntries(
        Object.keys(TYPE_TOTALS).map((k, i) => [k, Number(byType[i]?._sum.totalArea ?? 0)]),
      ),
    } as Record<'totalLand' | keyof typeof TYPE_TOTALS, number>;
    const card = (id: number, title: string, value: number, icon: string, color: string) => ({
      id,
      title,
      value: value.toFixed(2),
      unit: 'Acre',
      icon,
      color,
    });
    return {
      statistics,
      summaryCards: [
        card(1, 'Land Area', statistics.totalLand, 'Map', 'green'),
        card(2, 'Owned Land', statistics.ownedLand, 'Building2', 'green'),
        card(3, 'Leased In Land', statistics.leasedInLand, 'MapPinned', 'blue'),
        card(4, 'Leased Out Land', statistics.leasedOutLand, 'ArrowUpRight', 'orange'),
        card(5, 'Disputed Land', statistics.disputedLand, 'TriangleAlert', 'red'),
      ],
    };
  },
  options: { path: 'land-records', label: (row) => String(row.landLeaseName), filters: ['estate'] },
});

/** Add Lease Payment (`paymentFormData`). */
const paymentSchema = z.object({
  landLeaseId: ref(),
  year: text(4).regex(/^\d{4}$/, 'Enter the year, e.g. 2026'),
  /** Bangla year; left empty, it is worked out from the due date (new year on 14 April). */
  banglaYear: optText(4).refine((v) => v === null || /^\d{4}$/.test(v), 'Enter the Bangla year, e.g. 1433'),
  dueDate: reqDate(),
  amount: num(),
  paidAmount: optNum(),
  paymentDate: optDate(),
  status: oneOf(PAYMENT_STATUSES),
  paymentMethod: oneOf(PAYMENT_METHODS),
  referenceNo: optText(100),
  remarks: longText(),
});

export const landPaymentsRouter = defineResource('/land-payments', {
  name: 'landPayment',
  label: 'Lease payment',
  model: 'landPayment',
  schema: paymentSchema,
  search: ['year', 'banglaYear', 'referenceNo'],
  filters: ['landLeaseId', 'status', 'paymentMethod', 'year', 'banglaYear'],
  refs: { landLeaseId: { model: 'landRecord', label: 'landLeaseName' } },
  /** Newest first, so a payment just added is on page 1. */
  orderBy: [{ year: 'desc' }, { dueDate: 'desc' }, { createdAt: 'desc' }],
  onSave: (values) =>
    !values.banglaYear && values.dueDate instanceof Date ? { banglaYear: banglaYear(values.dueDate) } : {},
  /** Totals for the payment table (same filters): due, paid, and still to pay. */
  summary: async (where) => {
    const sums = await db.landPayment.aggregate({
      where,
      _count: { _all: true },
      _sum: { amount: true, paidAmount: true },
    });
    const amount = Number(sums._sum.amount ?? 0);
    const paidAmount = Number(sums._sum.paidAmount ?? 0);
    return {
      totalPayments: sums._count._all,
      amount,
      paidAmount,
      dueAmount: Math.max(0, amount - paidAmount),
    };
  },
});

/** Add Land / Lease Document (`documentFormData`). `file` is an id from POST /files. */
const documentSchema = z.object({
  landLeaseId: ref(),
  documentName: text(),
  documentType: oneOf(DOCUMENT_TYPES),
  documentNumber: optText(100),
  issueDate: optDate(),
  expiryDate: optDate(),
  file: fileId().refine((v) => v !== null, 'Document file is required'),
  remarks: longText(),
});

export const landDocumentsRouter = defineResource('/land-documents', {
  name: 'landDocument',
  label: 'Document',
  model: 'landDocument',
  schema: documentSchema,
  search: ['documentName', 'documentNumber'],
  filters: ['landLeaseId', 'documentType'],
  refs: { landLeaseId: { model: 'landRecord', label: 'landLeaseName' } },
  files: ['file'],
  orderBy: { createdAt: 'asc' },
  check: (values) =>
    Promise.resolve<Record<string, string>>(
      values.issueDate instanceof Date &&
        values.expiryDate instanceof Date &&
        values.expiryDate < values.issueDate
        ? { expiryDate: 'Expiry Date cannot be before Issue Date.' }
        : {},
    ),
});
