import { apiError, apiJson } from "@/lib/api/http";
import { handleApi } from "@/lib/api/route";
import {
  EnvelopeDocumentAccessError,
  getDraftEnvelopeDocumentForUser,
} from "@/lib/envelopes";
import {
  detectSigningFields,
  signingFieldServiceConfigured,
} from "@/lib/signing-field-service";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/envelopes/[id]/field-suggestions">,
) {
  const { id } = await context.params;
  return handleApi(
    request,
    "read",
    "api_field_suggestions_failure",
    async ({ actor }) => {
      if (!signingFieldServiceConfigured())
        return apiError(
          503,
          "internal_error",
          "Field detection is unavailable.",
        );
      try {
        const document = await getDraftEnvelopeDocumentForUser(
          actor.userId,
          id,
        );
        const detection = await detectSigningFields(
          document.body,
          request.signal,
        );
        if (detection.kind === "detected") return apiJson(detection.result);
        if (detection.kind === "unreadable")
          return apiError(
            400,
            "invalid_request",
            "This PDF could not be scanned.",
          );
        return apiError(
          503,
          "internal_error",
          "Field detection is unavailable.",
        );
      } catch (error) {
        if (error instanceof EnvelopeDocumentAccessError)
          return apiError(404, "not_found", "PDF not found.");
        throw error;
      }
    },
  );
}
