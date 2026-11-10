/**
 * RP1-135: Bangladesh's 8 divisions and 64 districts, each district with its division. One list for every page
 * that picks a division or district (Auction Centers first). Values are lower-case and hyphenated, so the
 * values saved before (`chattogram`, `sylhet`, `rangpur`, `dhaka`, `panchagarh`) stay valid.
 */
export type Place = { value: string; label: string };
export type District = Place & { division: string };

export const DIVISIONS: Place[] = [
  { value: 'barishal', label: 'Barishal' },
  { value: 'chattogram', label: 'Chattogram' },
  { value: 'dhaka', label: 'Dhaka' },
  { value: 'khulna', label: 'Khulna' },
  { value: 'mymensingh', label: 'Mymensingh' },
  { value: 'rajshahi', label: 'Rajshahi' },
  { value: 'rangpur', label: 'Rangpur' },
  { value: 'sylhet', label: 'Sylhet' },
];

const BY_DIVISION: Record<string, string[]> = {
  barishal: ['Barguna', 'Barishal', 'Bhola', 'Jhalokati', 'Patuakhali', 'Pirojpur'],
  chattogram: [
    'Bandarban',
    'Brahmanbaria',
    'Chandpur',
    'Chattogram',
    "Cox's Bazar",
    'Cumilla',
    'Feni',
    'Khagrachhari',
    'Lakshmipur',
    'Noakhali',
    'Rangamati',
  ],
  dhaka: [
    'Dhaka',
    'Faridpur',
    'Gazipur',
    'Gopalganj',
    'Kishoreganj',
    'Madaripur',
    'Manikganj',
    'Munshiganj',
    'Narayanganj',
    'Narsingdi',
    'Rajbari',
    'Shariatpur',
    'Tangail',
  ],
  khulna: [
    'Bagerhat',
    'Chuadanga',
    'Jashore',
    'Jhenaidah',
    'Khulna',
    'Kushtia',
    'Magura',
    'Meherpur',
    'Narail',
    'Satkhira',
  ],
  mymensingh: ['Jamalpur', 'Mymensingh', 'Netrokona', 'Sherpur'],
  rajshahi: ['Bogura', 'Chapainawabganj', 'Joypurhat', 'Naogaon', 'Natore', 'Pabna', 'Rajshahi', 'Sirajganj'],
  rangpur: [
    'Dinajpur',
    'Gaibandha',
    'Kurigram',
    'Lalmonirhat',
    'Nilphamari',
    'Panchagarh',
    'Rangpur',
    'Thakurgaon',
  ],
  sylhet: ['Habiganj', 'Moulvibazar', 'Sunamganj', 'Sylhet'],
};

/** "Cox's Bazar" → "coxs-bazar". */
const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-');

/** The 64 districts, by name. */
export const DISTRICTS: District[] = Object.entries(BY_DIVISION)
  .flatMap(([division, names]) => names.map((label) => ({ value: slug(label), label, division })))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * Sreemangal is an upazila of Moulvibazar, not a district, but the prototype's Auction Centers list it and saved
 * centers use it, so pages that need it add it with `withSreemangal`.
 */
export const SREEMANGAL: District = { value: 'sreemangal', label: 'Sreemangal', division: 'sylhet' };
export const withSreemangal = (list: District[]): District[] =>
  [...list, SREEMANGAL].sort((a, b) => a.label.localeCompare(b.label));

export const labelOfPlace = (list: Place[], value: unknown) =>
  list.find((p) => p.value === value)?.label ?? null;
