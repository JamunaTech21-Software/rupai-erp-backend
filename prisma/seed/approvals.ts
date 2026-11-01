import { type Database } from '../../src/lib/db.js';
import { MODULES } from '../../src/lib/approval.js';
import { newId } from '../../src/lib/ids.js';

/** RP1-69: approval On for every built module (a switch the admin already set is left as it is). */
export async function seedApprovalSettings(db: Database, userId: string): Promise<number> {
  let on = 0;
  for (const m of MODULES.filter((x) => x.built)) {
    const saved = await db.approvalSetting.findUnique({ where: { module: m.key } });
    if (!saved)
      await db.approvalSetting.create({ data: { module: m.key, enabled: true, updatedBy: userId } });
    if (saved?.enabled ?? true) on += 1;
  }
  return on;
}

const at = (iso: string) => new Date(`${iso}+06:00`);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * RP1-71: sample requests for the Approval Dashboard (only when there are none yet). The pending ones are
 * real requests that can be approved; the approved / rejected ones are history for the cards and filters.
 */
export async function seedApprovalRequests(db: Database, userId: string): Promise<number> {
  if (await db.changeRequest.count()) return 0;
  const estate = await db.estate.findFirst({ where: { estateCode: 'JTE-001', deletedAt: null } });
  if (!estate) return 0;
  const [rupganj, madhabpurMouza, land, nursery, field, division, employee, worker] = await Promise.all([
    db.mouza.findFirst({ where: { estate: estate.id, mouzaName: 'Rupganj', deletedAt: null } }),
    db.mouza.findFirst({ where: { estate: estate.id, mouzaName: 'Madhabpur', deletedAt: null } }),
    db.landRecord.findFirst({ where: { landLeaseName: 'Madhabpur Lease Land', deletedAt: null } }),
    db.nursery.findFirst({ where: { nurseryName: 'Central Nursery', deletedAt: null } }),
    db.fieldBlock.findFirst({ where: { estate: estate.id, deletedAt: null }, orderBy: { fieldCode: 'asc' } }),
    db.division.findFirst({
      where: { estate: estate.id, deletedAt: null },
      orderBy: { divisionCode: 'asc' },
    }),
    db.employee.findFirst({ where: { deletedAt: null }, orderBy: { employeeId: 'asc' } }),
    db.worker.findFirst({ where: { deletedAt: null }, orderBy: { workerId: 'asc' } }),
  ]);
  const [payment, document] = land
    ? await Promise.all([
        db.landPayment.findFirst({ where: { landLeaseId: land.id, year: '2026', deletedAt: null } }),
        db.landDocument.findFirst({ where: { landLeaseId: land.id, deletedAt: null } }),
      ])
    : [null, null];

  type Seed = {
    module: string;
    resource: string;
    page: string;
    applier: string;
    recordId: string;
    action: string;
    summary: string;
    requestedAt: Date;
    status?: 'pending' | 'approved' | 'rejected';
    payload?: unknown;
    newData?: unknown;
    oldData?: unknown;
    recordUpdatedAt?: Date;
    rejectReason?: string;
  };
  const list: Seed[] = [];
  const kit = (resource: string) => ({ resource, applier: `resource:${resource}` });

  // History: approved entries for records the seed made, and two rejected requests.
  list.push({
    module: 'estate',
    ...kit('estate'),
    page: 'Estate Profile',
    recordId: estate.id,
    action: 'create',
    summary: `Estate Profile — ${estate.estateCode} (${estate.estateName})`,
    requestedAt: at('2026-09-01T10:15:00'),
    status: 'approved',
  });
  if (division)
    list.push({
      module: 'estate',
      ...kit('division'),
      page: 'Division & Section',
      recordId: division.id,
      action: 'create',
      summary: `Division & Section — ${division.divisionName} (${division.divisionCode})`,
      requestedAt: at('2026-09-03T11:40:00'),
      status: 'approved',
    });
  if (field)
    list.push({
      module: 'estate',
      ...kit('field'),
      page: 'Field / Block',
      recordId: field.id,
      action: 'create',
      summary: `Field / Block — ${field.fieldCode} (${field.fieldName})`,
      requestedAt: at('2026-09-05T09:20:00'),
      status: 'approved',
    });
  if (employee)
    list.push({
      module: 'hr',
      ...kit('employee'),
      page: 'Employee',
      recordId: employee.id,
      action: 'create',
      summary: `Employee — ${employee.employeeId} (${employee.firstName} ${employee.lastName})`,
      requestedAt: at('2026-09-10T14:05:00'),
      status: 'approved',
    });
  if (worker)
    list.push({
      module: 'hr',
      ...kit('worker'),
      page: 'Worker',
      recordId: worker.id,
      action: 'create',
      summary: `Worker — ${worker.workerId} (${worker.firstName} ${worker.lastName})`,
      requestedAt: at('2026-09-12T16:30:00'),
      status: 'approved',
    });
  list.push({
    module: 'estate',
    ...kit('mouza'),
    page: 'Mouza',
    recordId: '01MZSEEDREJECTED0000000001',
    action: 'create',
    summary: `Mouza — Test Mouza (${estate.estateName})`,
    requestedAt: at('2026-09-15T12:00:00'),
    status: 'rejected',
    newData: { estate: estate.id, mouzaName: 'Test Mouza', jlNo: null, remarks: null },
    rejectReason: 'Not a real mouza; entered by mistake.',
  });
  if (madhabpurMouza)
    list.push({
      module: 'estate',
      ...kit('mouza'),
      page: 'Mouza',
      recordId: madhabpurMouza.id,
      action: 'update',
      summary: `Mouza — Madhabpur (${estate.estateName})`,
      requestedAt: at('2026-09-20T10:45:00'),
      status: 'rejected',
      oldData: {
        estate: estate.id,
        mouzaName: 'Madhabpur',
        jlNo: madhabpurMouza.jlNo,
        remarks: madhabpurMouza.remarks,
      },
      newData: { estate: estate.id, mouzaName: 'Madhabpur', jlNo: 'JL-145', remarks: madhabpurMouza.remarks },
      rejectReason: 'Wrong JL number.',
    });

  // Pending: real requests that the dashboard can approve or reject.
  list.push({
    module: 'estate',
    ...kit('mouza'),
    page: 'Mouza',
    recordId: '01MZSEEDPENDING00000000001',
    action: 'create',
    summary: `Mouza — Narayanpur (${estate.estateName})`,
    requestedAt: at('2026-10-20T10:24:00'),
    payload: { estate: estate.id, mouzaName: 'Narayanpur', jlNo: 'JL-50', remarks: '' },
    newData: { estate: estate.id, mouzaName: 'Narayanpur', jlNo: 'JL-50', remarks: null },
  });
  if (rupganj) {
    const form = { estate: estate.id, mouzaName: 'Rupganj', jlNo: rupganj.jlNo, remarks: rupganj.remarks };
    list.push({
      module: 'estate',
      ...kit('mouza'),
      page: 'Mouza',
      recordId: rupganj.id,
      action: 'update',
      summary: `Mouza — Rupganj (${estate.estateName})`,
      requestedAt: at('2026-10-22T09:50:00'),
      payload: { ...form, jlNo: 'JL-49A' },
      oldData: form,
      newData: { ...form, jlNo: 'JL-49A' },
      recordUpdatedAt: rupganj.updatedAt,
    });
  }
  if (land && payment) {
    const form = {
      landLeaseId: land.id,
      year: payment.year,
      banglaYear: payment.banglaYear,
      dueDate: day(payment.dueDate),
      amount: Number(payment.amount),
      paidAmount: payment.paidAmount === null ? null : Number(payment.paidAmount),
      paymentDate: day(payment.paymentDate),
      status: payment.status,
      paymentMethod: payment.paymentMethod,
      referenceNo: payment.referenceNo,
      remarks: payment.remarks,
    };
    const next = { ...form, paidAmount: 110000, paymentDate: '2026-10-15', referenceNo: 'TRX-2026-1015' };
    list.push({
      module: 'estate',
      ...kit('landPayment'),
      page: 'Lease Payment',
      recordId: payment.id,
      action: 'update',
      summary: `Lease Payment — ${land.landLeaseName} — ${payment.year}`,
      requestedAt: at('2026-10-24T16:18:00'),
      payload: next,
      oldData: form,
      newData: next,
      recordUpdatedAt: payment.updatedAt,
    });
  }
  if (land && document)
    list.push({
      module: 'estate',
      ...kit('landDocument'),
      page: 'Land Document',
      recordId: document.id,
      action: 'delete',
      summary: `Land Document — ${land.landLeaseName} — ${document.documentName}`,
      requestedAt: at('2026-10-26T11:05:00'),
      oldData: { documentName: document.documentName, documentType: document.documentType },
      recordUpdatedAt: document.updatedAt,
    });
  if (nursery) {
    const bed = {
      name: 'Seedling Bed G',
      code: 'NB-007',
      clone: 'TV-25',
      area: '0.4',
      plants: '2100',
      plantingDate: '2026-10-10',
      status: 'Active',
    };
    list.push({
      module: 'plantation',
      resource: 'nurseryBed',
      applier: 'custom:nurseryBed',
      page: 'Nursery Management',
      recordId: '01NBSEEDPENDING00000000001',
      action: 'create',
      summary: `Nursery Management — ${nursery.nurseryName}: Bed NB-007 (Seedling Bed G)`,
      requestedAt: at('2026-10-28T14:30:00'),
      payload: { params: { id: nursery.id }, body: bed, recordId: '01NBSEEDPENDING00000000001' },
      newData: { ...bed, area: 0.4, plants: 2100 },
    });
  }

  for (const r of list) {
    const status = r.status ?? 'pending';
    await db.changeRequest.create({
      data: {
        id: newId(),
        module: r.module,
        resource: r.resource,
        page: r.page,
        applier: r.applier,
        recordId: r.recordId,
        action: r.action,
        payload: (r.payload ?? undefined) as never,
        newData: (r.newData ?? undefined) as never,
        oldData: (r.oldData ?? undefined) as never,
        recordUpdatedAt: r.recordUpdatedAt ?? null,
        summary: r.summary,
        status,
        requestedBy: userId,
        requestedAt: r.requestedAt,
        reviewedBy: status === 'pending' ? null : userId,
        reviewedAt: status === 'pending' ? null : new Date(r.requestedAt.getTime() + 2 * 3_600_000),
        rejectReason: r.rejectReason ?? null,
      },
    });
  }
  return list.length;
}
