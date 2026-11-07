import { type Database } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';
import { seedOne } from './util.js';

/** RP1-102 sample warehouse: the prototype's Warehouse Summary and mobile numbers (teaWarehouseData.js). */
const MOBILES = [
  ['+880-1711-123456', 'Mr. Sohel Rana', 'Warehouse Manager', 'primary', true],
  ['+880-1819-654321', 'Mr. Rahim Uddin', 'Asst. Warehouse Manager', 'secondary', false],
  ['+880-1912-345678', 'Mr. Karim Ali', 'Store In-Charge', 'whatsapp', false],
  ['+880-1733-987654', 'Mr. Imran Hossain', 'Store Keeper', 'office', false],
  ['+880-1622-112233', 'Mr. Shakil Ahmed', 'Helper Supervisor', 'other', false],
] as const;

export async function seedTeaWarehouses(db: Database, userId: string): Promise<number> {
  const warehouseId = await seedOne(
    db,
    userId,
    'teaWarehouse',
    { warehouseCode: 'WH-001' },
    {
      warehouseCode: 'WH-001',
      warehouseName: 'Main Warehouse',
      shortName: 'MAIN WH',
      location: '63, Motijheel C/A, Dhaka-1000, Bangladesh',
      warehouseType: 'main',
      capacity: 5000,
      inChargePerson: 'Mr. Sohel Rana',
      officePhone: '+880-2-9556789',
      status: 'active',
    },
  );
  if (!(await db.teaWarehouseMobile.count({ where: { warehouseId } })))
    await db.teaWarehouseMobile.createMany({
      data: MOBILES.map(([number, contactPerson, designation, type, primary], position) => ({
        id: newId(),
        warehouseId,
        position,
        number,
        contactPerson,
        designation,
        type,
        primary,
      })),
    });
  return 1;
}
