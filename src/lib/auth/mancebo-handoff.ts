import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb, type DbExecutor } from "../db/connection.ts";

export const manceboOrigin = "https://mancebo.ai";
export const manceboDocuments = manceboOrigin + "/documents";
export const signingSessionSeconds = 30 * 60;
export const signingTicketPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function readManceboSigningConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const tenantId = env.MANCEBO_SIGNING_TENANT_ID;
  const secret = env.MANCEBO_SIGNING_BRIDGE_SECRET;
  if (!secret) return null;
  if (!tenantId || !uuid.test(tenantId) || !signingTicketPattern.test(secret)) {
    throw new Error("Invalid Mancebo signing bridge configuration.");
  }
  return { tenantId, secret };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function verifiesSigningBridge(
  authorization: string | null,
  secret: string,
) {
  return Boolean(
    authorization &&
    timingSafeEqual(digest(authorization), digest("Bearer " + secret)),
  );
}

export function parseSigningGrant(value: unknown, tenantId: string) {
  if (!value || typeof value !== "object") return null;
  const { tenant_id, subject, email, return_to } = value as Record<
    string,
    unknown
  >;
  if (
    tenant_id !== tenantId ||
    typeof subject !== "string" ||
    !uuid.test(subject) ||
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+$/.test(email) ||
    (return_to !== "documents" && return_to !== "new")
  )
    return null;
  return { subject, email: email.toLowerCase(), destination: return_to };
}

type SigningGrant = NonNullable<ReturnType<typeof parseSigningGrant>>;

export async function bindSigningInstall(
  tenantId: string,
  database: DbExecutor = getDb(),
) {
  await database.query(
    "INSERT INTO mancebo_signing_install (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [tenantId],
  );
  const result = await database.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM mancebo_signing_install WHERE singleton",
  );
  return result.rows[0]?.tenant_id === tenantId;
}

export async function issueSigningTicket(
  tenantId: string,
  grant: SigningGrant,
  database: DbExecutor = getDb(),
) {
  const ticket = randomBytes(32).toString("base64url");
  await database.query(
    `WITH expired AS (
       DELETE FROM mancebo_signing_ticket WHERE expires_at <= now()
     )
     INSERT INTO mancebo_signing_ticket (ticket_hash, tenant_id, subject, email, destination)
     VALUES ($1, $2, $3, $4, $5)`,
    [digest(ticket), tenantId, grant.subject, grant.email, grant.destination],
  );
  return ticket;
}

export async function consumeSigningTicket(
  tenantId: string,
  ticket: string,
  database: DbExecutor = getDb(),
) {
  const { rows } = await database.query<SigningGrant>(
    `DELETE FROM mancebo_signing_ticket
      WHERE ticket_hash = $1 AND tenant_id = $2 AND expires_at > now()
      RETURNING subject, email, destination`,
    [digest(ticket), tenantId],
  );
  return rows[0] ?? null;
}

export async function ensureSigningUser(
  grant: SigningGrant,
  database: DbExecutor = getDb(),
) {
  const id = "mancebo-" + grant.subject;
  // An existing email on a different account remains a unique-key conflict.
  // Mancebo identities are attached only by their verified account ID.
  await database.query(
    `INSERT INTO public."user" (id, name, email, "emailVerified")
     VALUES ($1, $2, $3, true)
     ON CONFLICT (id) DO UPDATE
       SET email = excluded.email, "emailVerified" = true, "updatedAt" = now()
     WHERE "user".email IS DISTINCT FROM excluded.email OR NOT "user"."emailVerified"`,
    [id, grant.email.split("@")[0], grant.email],
  );
  return id;
}
