import { eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { users, workspaceInvites } from './schema.ts';

const PRIMARY_ADMIN_EMAIL = 'thuyvu2254@gmail.com';

export type UserRole = 'admin' | 'editor' | 'viewer';

export async function getOrCreateUser(uid: string, email: string, displayName = '') {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const existing = await db.select().from(users).where(eq(users.uid, uid)).limit(1);

    if (existing.length > 0) {
      const current = existing[0];
      // Ensure primary owner email retains admin role
      const nextRole =
        cleanEmail === PRIMARY_ADMIN_EMAIL && current.role !== 'admin' ? 'admin' : current.role;

      if (current.email !== cleanEmail || current.displayName !== displayName || current.role !== nextRole) {
        const updated = await db
          .update(users)
          .set({ email: cleanEmail, displayName, role: nextRole })
          .where(eq(users.uid, uid))
          .returning();
        return updated[0];
      }
      return current;
    }

    // Determine initial role for new sign-in
    let assignedRole: UserRole = 'viewer';
    if (cleanEmail === PRIMARY_ADMIN_EMAIL) {
      assignedRole = 'admin';
    } else {
      const invite = await db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.email, cleanEmail))
        .limit(1);
      if (invite.length > 0) {
        const invRole = invite[0].role;
        if (invRole === 'admin' || invRole === 'editor' || invRole === 'viewer') {
          assignedRole = invRole;
        }
      } else {
        const countRes = await db.select({ count: sql<number>`count(*)::int` }).from(users);
        if ((countRes[0]?.count ?? 0) === 0) {
          assignedRole = 'admin';
        }
      }
    }

    const inserted = await db
      .insert(users)
      .values({
        uid,
        email: cleanEmail,
        displayName,
        role: assignedRole,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email: cleanEmail, displayName },
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user profile.', { cause: error });
  }
}
