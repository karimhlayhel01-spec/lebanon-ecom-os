import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";

const SESSION_COOKIE = "leb_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export async function createSession(userId: string) {
  await ensureMigrated();
  const id = newId();
  const createdAt = nowIso();
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await db.insert(schema.sessions).values({
    id,
    userId,
    expiresAt,
    createdAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(expiresAt),
  });

  return id;
}

export async function destroySession() {
  await ensureMigrated();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Invalidate every session for the user and clear the current cookie. */
export async function destroyAllSessions(userId: string) {
  await ensureMigrated();
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  await ensureMigrated();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const row = await db
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.id, sessionId))
    .then((rows) => rows[0]);

  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }

  return { id: row.userId, email: row.email, name: row.name };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}
