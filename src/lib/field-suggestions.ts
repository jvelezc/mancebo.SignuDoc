import { z } from "zod";

const suggestion = z
  .object({
    page: z.number().int().positive(),
    type: z.enum(["signature", "initials", "date", "name", "text", "checkbox"]),
    label: z.string().min(1).max(80),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    required: z.boolean(),
    source: z.enum(["pdf_form", "text_label"]),
  })
  .refine(
    (field) =>
      field.x + field.width <= 1.000001 && field.y + field.height <= 1.000001,
  );

export const fieldSuggestions = z
  .object({
    pages: z.number().int().positive(),
    scannedPages: z.number().int().positive().max(100),
    truncated: z.boolean(),
    fields: z.array(suggestion).max(200),
  })
  .refine(
    ({ fields, pages, scannedPages }) =>
      scannedPages <= pages &&
      fields.every((field) => field.page <= scannedPages),
  );

export type SuggestedField = z.infer<typeof suggestion>;
