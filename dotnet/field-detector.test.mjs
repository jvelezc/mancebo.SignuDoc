import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

test("the .NET signing detector finds widgets and labeled blanks without changing the PDF", async (t) => {
  const token = randomBytes(32).toString("hex");
  const origin = "http://127.0.0.1:55482";
  const child = spawn(
    "dotnet",
    [
      "dotnet/Mancebo.Signing.Fields/bin/Debug/net10.0/Mancebo.Signing.Fields.dll",
    ],
    {
      env: {
        ...process.env,
        ASPNETCORE_URLS: origin,
        SIGNING_FIELD_SERVICE_TOKEN: token,
      },
      stdio: "pipe",
    },
  );
  let diagnostic = "";
  child.stderr.on("data", (data) => {
    diagnostic += String(data);
  });
  const exited = once(child, "exit");
  t.after(async () => {
    child.kill();
    await exited;
  });
  let ready = false;
  for (let i = 0; i < 80 && !ready && child.exitCode === null; i++) {
    ready = await fetch(origin + "/healthz").then(
      (response) => response.ok,
      () => false,
    );
    if (!ready) await setTimeout(150);
  }
  assert.equal(
    ready,
    true,
    "build the field worker before running this test: " + diagnostic,
  );

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 600]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Signature: __________________", {
    x: 30,
    y: 78,
    size: 12,
    font,
  });
  const form = pdf.getForm();
  form
    .createTextField("Date")
    .addToPage(page, { x: 40, y: 375, width: 120, height: 24 });
  const checkbox = form.createCheckBox("I agree");
  checkbox.addToPage(page, { x: 40, y: 310, width: 15, height: 15 });
  const pdfBytes = await pdf.save();

  const endpoint = origin + "/v1/field-suggestions";
  const detection = (authority, body) =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/pdf",
        ...(authority ? { authorization: "Bearer " + authority } : {}),
      },
      body,
    });
  assert.equal((await detection(null, pdfBytes)).status, 401);
  assert.equal((await detection(token, new Uint8Array([0, 1, 2]))).status, 422);
  const response = await detection(token, pdfBytes);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.pages, 1);
  assert.equal(result.scannedPages, 1);
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.fields.map(({ source, type }) => [source, type]).sort(),
    [
      ["pdf_form", "checkbox"],
      ["pdf_form", "date"],
      ["text_label", "signature"],
    ],
  );
  const date = result.fields.find(({ type }) => type === "date");
  assert.ok(Math.abs(date.x - 0.1) < 0.01);
  assert.ok(Math.abs(date.y - 0.335) < 0.01);
  const signature = result.fields.find(({ type }) => type === "signature");
  assert.ok(signature.x > 0.17 && signature.y > 0.8 && signature.width > 0.2);
  assert.equal(
    (await PDFDocument.load(pdfBytes)).getForm().getTextField("Date").getText(),
    undefined,
  );
});
