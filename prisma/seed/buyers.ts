import { type Database } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';
import { seedOne } from './util.js';

/** RP1-117 sample buyers: the prototype's Buyer List (buyerSetupData.js), with their contact persons. */
type Contact = [string, string, string, string, boolean];
type Sample = [string, string, string, string, string, string, string, string, Contact[], string?];
const LOCAL = 'LOCAL';
const PACKER = 'PACKER';
const BUYERS: Sample[] = [
  [
    'BUY-001',
    'NATIONAL BROKERS LIMITED',
    'NATIONAL',
    LOCAL,
    'BOTH',
    '63, Motijheel C/A, Dhaka-1000, Bangladesh',
    '+880-2-9561234',
    'info@nationalbrokers.com',
    [
      ['+880-1711-123456', 'Mr. Sohel Rana', 'MANAGING_DIRECTOR', 'PRIMARY', true],
      ['+880-1810-654321', 'Mr. Rahim Uddin', 'GENERAL_MANAGER', 'SECONDARY', false],
      ['+880-1912-345678', 'Mr. Karim Ali', 'ACCOUNTS_MANAGER', 'WHATSAPP', false],
      ['+880-1713-987654', 'Mr. Manzur Rahman', 'MARKETING_EXECUTIVE', 'OFFICE', false],
    ],
  ],
  [
    'BUY-002',
    'PURBA BANGLA BROKERS LIMITED',
    'PURBA BANGLA',
    LOCAL,
    'INTERNAL',
    'Agrabad Commercial Area, Chattogram, Bangladesh',
    '+880-1711-123456',
    'info@purbabangla.com',
    [['+880-1711-987654', 'Mr. Abdul Karim', 'GENERAL_MANAGER', 'PRIMARY', true]],
  ],
  [
    'BUY-003',
    'K.S BROKERS LIMITED',
    'K.S BROKERS',
    LOCAL,
    'EXPORT',
    'Kawran Bazar, Dhaka, Bangladesh',
    '+880-2-8312345',
    'info@ksbrokers.com',
    [['+880-1711-456789', 'Mr. Hasan Ahmed', 'SALES_MANAGER', 'PRIMARY', true]],
  ],
  [
    'BUY-004',
    'PLANTERS BROKERS LIMITED',
    'PLANTERS',
    LOCAL,
    'BOTH',
    'Banani, Dhaka, Bangladesh',
    '+880-2-9556789',
    'info@plantersbrokers.com',
    [['+880-1711-112233', 'Mr. Tanvir Ahmed', 'MANAGING_DIRECTOR', 'PRIMARY', true]],
  ],
  [
    'BUY-005',
    'UNITY BROKERS LIMITED',
    'UNITY',
    LOCAL,
    'EXPORT',
    'Gulshan, Dhaka, Bangladesh',
    '+880-2-9567890',
    'info@unitybrokers.com',
    [['+880-1711-223344', 'Mr. Imran Hossain', 'SALES_MANAGER', 'PRIMARY', true]],
  ],
  [
    'BUY-006',
    'PROGRESSIVE BROKERS LTD',
    'PROGRESSIVE',
    PACKER,
    'EXPORT',
    'Tejgaon Industrial Area, Dhaka, Bangladesh',
    '+880-2-9562345',
    'info@progressive.com',
    [['+880-1711-334455', 'Mr. Faisal Khan', 'PURCHASE_MANAGER', 'PRIMARY', true]],
  ],
  [
    'BUY-007',
    'PRODUCE BROKERS LIMITED',
    'PRODUCE',
    LOCAL,
    'BOTH',
    'Motijheel, Dhaka, Bangladesh',
    '+880-2-9563456',
    'info@producebrokers.com',
    [['+880-1711-445566', 'Mr. Arif Hossain', 'GENERAL_MANAGER', 'PRIMARY', true]],
  ],
  [
    'BUY-008',
    'M/S SHAH BROTHERS',
    'SHAH BROTHERS',
    PACKER,
    'EXPORT',
    'Narayanganj, Bangladesh',
    '+880-2-9564567',
    'info@shahbrothers.com',
    [['+880-1711-556677', 'Mr. Shahidul Islam', 'MANAGING_DIRECTOR', 'PRIMARY', true]],
    'Currently inactive.',
  ],
  [
    'BUY-009',
    'GLOBAL TEA TRADERS',
    'GLOBAL',
    PACKER,
    'BOTH',
    'Gulshan-2, Dhaka, Bangladesh',
    '+880-2-9565678',
    'info@globaltea.com',
    [['+880-1711-667788', 'Mr. Nayeem Hasan', 'SALES_MANAGER', 'PRIMARY', true]],
  ],
  [
    'BUY-010',
    'A.ONE TEA COMPANY',
    'A.ONE',
    LOCAL,
    'INTERNAL',
    'Chattogram, Bangladesh',
    '+880-2-9566789',
    'info@aonetea.com',
    [['+880-1711-778899', 'Mr. Sabbir Ahmed', 'PURCHASE_MANAGER', 'PRIMARY', true]],
  ],
];

export async function seedBuyers(db: Database, userId: string): Promise<number> {
  for (const [
    buyerCode,
    buyerName,
    shortName,
    buyerType,
    tradingType,
    address,
    phone,
    email,
    contacts,
    remarks,
  ] of BUYERS) {
    const buyerId = await seedOne(
      db,
      userId,
      'buyer',
      { buyerCode },
      {
        buyerCode,
        buyerName,
        shortName,
        buyerType,
        tradingType,
        country: 'BANGLADESH',
        address,
        phone,
        email,
        // The prototype's one inactive buyer is the one with remarks.
        status: remarks ? 'INACTIVE' : 'ACTIVE',
        remarks: remarks ?? null,
      },
    );
    if (!(await db.buyerContact.count({ where: { buyerId } })))
      await db.buyerContact.createMany({
        data: contacts.map(([mobileNumber, contactPersonName, designation, type, isPrimary], position) => ({
          id: newId(),
          buyerId,
          position,
          mobileNumber,
          contactPersonName,
          designation,
          type,
          isPrimary,
        })),
      });
  }
  return BUYERS.length;
}
