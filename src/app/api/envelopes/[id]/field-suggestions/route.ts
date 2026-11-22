import { requireVerifiedSenderSession } from "@/lib/auth/route-session";
import {
  EnvelopeDocumentAccessError,
  getDraftEnvelopeDocumentForUser,
} from "@/lib/envelopes";
import {
  detectSigningFields,
  signingFieldServiceConfigured,
} from "@/lib/signing-field-service";

const privateHeaders = { "cache-control": "private, no-store" };

export async function GET(
  request: Request,
  context: RouteContext<"/api/envelopes/[id]/field-suggestions">,
) {
  const session = await requireVerifiedSenderSession(request);
  if (session instanceof Response) return session;
  const { id } = await context.params;
  if (!signingFieldServiceConfigured())
    return new Response(null, { status: 204, headers: privateHeaders });

  try {
    // Source is picked from the caller's envelope. The client supplies no URL or object key.
    const document = await getDraftEnvelopeDocumentForUser(session.user.id, id);
    const detection = await detectSigningFields(document.body, request.signal);
    if (detection.kind === "unreadable")
      return Response.json(
        {
          message:
            "This PDF could not be scanned. You can still place fields by hand.",
        },
        { status: 422, headers: privateHeaders },
      );
    if (detection.kind !== "detected")
      throw new Error("Field scanner unavailable.");
    return Response.json(detection.result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof EnvelopeDocumentAccessError)
      return Response.json(
        { message: "This PDF is unavailable." },
        { status: error.statusCode, headers: privateHeaders },
      );
    return Response.json(
      {
        message:
          "Field detection is unavailable. Try again or place the fields by hand.",
      },
      { status: 503, headers: privateHeaders },
    );
  }
}
