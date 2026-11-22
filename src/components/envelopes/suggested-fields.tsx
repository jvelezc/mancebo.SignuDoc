"use client";

import { useEffect, useState } from "react";
import { fieldSuggestions, type SuggestedField } from "@/lib/field-suggestions";

type Suggestions = ReturnType<typeof fieldSuggestions.parse>;
type State = { result?: Suggestions; unavailable?: true; message?: string };

export function SuggestedFields({
  envelopeId,
  signerName,
  onPlace,
}: {
  envelopeId: string;
  signerName: string;
  onPlace: (field: SuggestedField) => void;
}) {
  const [state, setState] = useState<State>();
  const [retry, setRetry] = useState(0);
  const [placed, setPlaced] = useState<Set<number>>(new Set());

  useEffect(() => {
    const request = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          "/api/envelopes/" +
            encodeURIComponent(envelopeId) +
            "/field-suggestions",
          {
            signal: request.signal,
            cache: "no-store",
          },
        );
        if (request.signal.aborted) return;
        if (response.status === 204) return setState({ unavailable: true });
        if (response.status === 422)
          return setState({
            message: "This PDF could not be scanned. Place its fields by hand.",
          });
        if (!response.ok) throw new Error("Detection unavailable.");
        const result = fieldSuggestions.parse(await response.json());
        if (!request.signal.aborted) setState({ result });
      } catch {
        if (!request.signal.aborted)
          setState({
            message: "Couldn’t detect fields. Try again or place them by hand.",
          });
      }
    }
    void load();
    return () => request.abort();
  }, [envelopeId, retry]);

  if (state?.unavailable) return null;
  const result = state?.result;
  return (
    <section
      aria-label="Suggested PDF fields"
      className="panel rounded-[1.25rem] p-4"
    >
      <h2 className="font-semibold">Suggested fields</h2>
      {!state && (
        <p role="status" className="mt-2 text-sm">
          Checking the PDF for fields…
        </p>
      )}
      {state?.message && (
        <>
          <p role="status" className="mt-2 text-sm">
            {state.message}
          </p>
          <button
            className="min-h-11 text-sm font-semibold underline"
            type="button"
            onClick={() => {
              setState(undefined);
              setRetry(retry + 1);
            }}
          >
            Check again
          </button>
        </>
      )}
      {result && (
        <>
          {result.truncated && (
            <p className="mt-2 text-sm">
              Only part of this PDF was scanned. Check the remaining pages
              yourself.
            </p>
          )}
          {result.fields.length ? (
            <>
              <p className="mt-2 text-sm">
                Add a field for {signerName}, then move it on the page as
                needed.
              </p>
              <ul
                className="mt-2 max-h-44 space-y-1 overflow-y-auto"
                aria-label="Fields found"
              >
                {result.fields.map((field, index) => (
                  <li key={index}>
                    <button
                      className="min-h-11 w-full rounded-lg border border-(--edge) px-3 text-left text-sm disabled:opacity-60"
                      disabled={placed.has(index)}
                      type="button"
                      aria-label={
                        (placed.has(index) ? "Added " : "Add ") +
                        field.label +
                        ", page " +
                        field.page +
                        " for " +
                        signerName
                      }
                      onClick={() => {
                        onPlace(field);
                        setPlaced((current) => new Set(current).add(index));
                      }}
                    >
                      {placed.has(index) ? "Added " : "Add "}
                      {field.label} · page {field.page}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p role="status" className="mt-2 text-sm">
              No fields were suggested. Choose a field to place it yourself.
            </p>
          )}
        </>
      )}
    </section>
  );
}
