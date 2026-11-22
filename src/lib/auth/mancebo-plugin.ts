import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { z } from "zod";

import type { DbExecutor } from "../db/connection.ts";
import {
  consumeSigningTicket,
  ensureSigningUser,
  signingTicketPattern,
} from "./mancebo-handoff.ts";

export function manceboSigningPlugin(database: DbExecutor, tenantId?: string) {
  return {
    id: "mancebo-signing",
    endpoints: {
      redeemManceboSigningTicket: createAuthEndpoint.serverOnly(
        {
          method: "POST",
          body: z.object({ ticket: z.string().regex(signingTicketPattern) }),
        },
        async (context) => {
          if (!tenantId)
            return context.json({ error: "Unavailable" }, { status: 404 });
          const grant = await consumeSigningTicket(
            tenantId,
            context.body.ticket,
            database,
          );
          if (!grant) return context.json({ destination: null });
          const id = await ensureSigningUser(grant, database);
          const user = await context.context.internalAdapter.findUserById(id);
          if (!user) throw new Error("Signing user was not provisioned.");
          const session = await context.context.internalAdapter.createSession(
            user.id,
          );
          if (!session) throw new Error("Signing session was not created.");
          await setSessionCookie(context, { session, user });
          return context.json({ destination: grant.destination });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
