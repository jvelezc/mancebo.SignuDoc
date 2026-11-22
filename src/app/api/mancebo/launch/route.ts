import {
  bindSigningInstall,
  issueSigningTicket,
  parseSigningGrant,
  readManceboSigningConfig,
  verifiesSigningBridge,
} from "@/lib/auth/mancebo-handoff";
import { getSetupState } from "@/lib/settings";
import { readLimitedBody } from "@/lib/utils/limited-body";

const headers = { "Cache-Control": "no-store" };

function decodeRequest(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const config = readManceboSigningConfig();
    if (!config) return new Response(null, { status: 404, headers });
    if (
      !verifiesSigningBridge(
        request.headers.get("Authorization"),
        config.secret,
      )
    ) {
      return new Response(null, { status: 401, headers });
    }
    const bytes = await readLimitedBody(request, 1024);
    if (!bytes) return new Response(null, { status: 413, headers });
    const grant = parseSigningGrant(decodeRequest(bytes), config.tenantId);
    if (!grant) return new Response(null, { status: 400, headers });
    if (
      (await getSetupState()).status !== "complete" ||
      !(await bindSigningInstall(config.tenantId))
    ) {
      console.error(
        JSON.stringify({ event: "mancebo_signing_install_not_ready" }),
      );
      return new Response(null, { status: 503, headers });
    }
    return Response.json(
      { ticket: await issueSigningTicket(config.tenantId, grant) },
      { status: 201, headers },
    );
  } catch {
    console.error(
      JSON.stringify({ event: "mancebo_signing_ticket_issue_failed" }),
    );
    return new Response(null, { status: 503, headers });
  }
}
