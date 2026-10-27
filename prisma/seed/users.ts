import { type Database } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';
import { hashPassword } from '../../src/modules/auth/service.js';

/** The login every developer uses (README). Its password is reset on every seed. */
export const ADMIN = {
  username: 'admin',
  password: 'Admin@12345',
  name: 'Administrator',
  email: 'admin@rupai.local',
};

export async function seedUsers(db: Database): Promise<string> {
  const passwordHash = await hashPassword(ADMIN.password);
  const admin = await db.user.upsert({
    where: { username: ADMIN.username },
    update: { passwordHash, status: 'active', name: ADMIN.name, email: ADMIN.email },
    create: { id: newId(), username: ADMIN.username, passwordHash, name: ADMIN.name, email: ADMIN.email },
  });
  return admin.id;
}
