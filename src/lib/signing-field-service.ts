import { fieldSuggestions } from "./field-suggestions.ts";

export function signingFieldServiceConfigured(env = process.env) {
  return Boolean(
    env.SIGNING_FIELD_SERVICE_URL && env.SIGNING_FIELD_SERVICE_TOKEN,
  );
}

export async function detectSigningFields(
  pdf: Uint8Array,
  signal: AbortSignal,
) {
  const address = process.env.SIGNING_FIELD_SERVICE_URL;
  const token = process.env.SIGNING_FIELD_SERVICE_TOKEN;
  if (!address || !token) return { kind: "unavailable" } as const;
  const response = await fetch(new URL("/v1/field-suggestions", address), {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/pdf",
    },
    body: pdf.slice().buffer as ArrayBuffer,
    signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
  });
  if (response.status === 422) return { kind: "unreadable" } as const;
  if (!response.ok) return { kind: "unavailable" } as const;
  return {
    kind: "detected",
    result: fieldSuggestions.parse(await response.json()),
  } as const;
}
