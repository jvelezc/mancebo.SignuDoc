import { splitSetCookieHeader } from "better-auth/cookies";

import {
  manceboDocuments,
  manceboOrigin,
  readManceboSigningConfig,
  signingTicketPattern,
} from "@/lib/auth/mancebo-handoff";
import { getAuth } from "@/lib/auth/server";
import { readLimitedBody } from "@/lib/utils/limited-body";

const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
const restart = () =>
  new Response(null, {
    status: 303,
    headers: { ...headers, Location: manceboDocuments + "?connection=retry" },
  });

export async function POST(request: Request) {
  if (request.headers.get("Origin") !== manceboOrigin) {
    return new Response(null, { status: 403, headers });
  }
  if (
    request.headers.get("Content-Type")?.split(";")[0] !==
    "application/x-www-form-urlencoded"
  ) {
    return new Response(null, { status: 415, headers });
  }
  try {
    if (!readManceboSigningConfig())
      return new Response(null, { status: 404, headers });
    const bytes = await readLimitedBody(request, 128);
    if (!bytes) return new Response(null, { status: 413, headers });
    const params = new URLSearchParams(new TextDecoder().decode(bytes));
    const ticket = params.get("ticket");
    if (params.size !== 1 || !ticket || !signingTicketPattern.test(ticket))
      return restart();
    const result = await getAuth().api.redeemManceboSigningTicket({
      body: { ticket },
      asResponse: true,
    });
    if (!result.ok) return restart();
    const { destination } = await result.json();
    if (destination !== "new" && destination !== "documents") return restart();
    const cookieHeader = result.headers.get("Set-Cookie");
    if (!cookieHeader)
      throw new Error("Signing session cookie was not issued.");
    const response = new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: destination === "new" ? "/envelopes/new" : "/dashboard",
      },
    });
    for (const cookie of splitSetCookieHeader(cookieHeader)) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  } catch {
    console.error(JSON.stringify({ event: "mancebo_signing_session_failed" }));
    return restart();
  }
}
