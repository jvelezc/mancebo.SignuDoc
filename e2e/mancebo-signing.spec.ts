import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import pg from "pg";

import { e2eDatabaseUrl } from "../playwright.config";
import { writeSamplePdf } from "./support/sample-pdf";
import { startSigningHttps } from "./support/signing-https";

const tenantId = process.env.MANCEBO_SIGNING_TENANT_ID;
const secret = process.env.MANCEBO_SIGNING_BRIDGE_SECRET;
const parent = "https://mancebo.ai";
const subject = "b0000000-0000-4000-8000-000000000001";
const second = "b0000000-0000-4000-8000-000000000002";
test.use({ ignoreHTTPSErrors: true });

async function issue(
  request: APIRequestContext,
  id: string,
  destination: "new" | "documents",
) {
  const result = await request.post("/api/mancebo/launch", {
    headers: { Authorization: "Bearer " + secret },
    data: {
      tenant_id: tenantId,
      subject: id,
      email: id === subject ? "sender@example.test" : "second@example.test",
      return_to: destination,
    },
  });
  expect(result.status()).toBe(201);
  const { ticket } = await result.json();
  expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return ticket as string;
}

test("a Mancebo account opens signing, uploads a document and keeps the draft private", async ({
  page,
  browser,
  baseURL,
  request,
}, info) => {
  test.skip(
    !tenantId || !secret,
    "Run with the two Mancebo signing bridge settings in a disposable install.",
  );
  const database = new pg.Pool({ connectionString: e2eDatabaseUrl });
  const signing = await startSigningHttps(baseURL!);
  try {
    await database.query(
      `INSERT INTO public."user" (id, name, email, "emailVerified", role)
       VALUES ('bootstrap-test', 'Test administrator', 'bootstrap@example.test', true, 'admin')`,
    );
    await database.query(
      `INSERT INTO app_settings (organization_name, created_at, updated_at)
       VALUES ('Mancebo Document Signing', 0, 0)`,
    );

    const unauthenticated = await request.post("/api/mancebo/launch", {
      data: {
        tenant_id: tenantId,
        subject,
        email: "sender@example.test",
        return_to: "new",
      },
    });
    expect(unauthenticated.status()).toBe(401);
    const otherTenant = await request.post("/api/mancebo/launch", {
      headers: { Authorization: "Bearer " + secret },
      data: {
        tenant_id: second,
        subject,
        email: "sender@example.test",
        return_to: "new",
      },
    });
    expect(otherTenant.status()).toBe(400);

    const ticket = await issue(request, subject, "new");
    const untrustedOrigin = await request.post("/api/mancebo/session", {
      headers: { Origin: "https://other.mancebo.ai" },
      form: { ticket },
      maxRedirects: 0,
    });
    expect(untrustedOrigin.status()).toBe(403);
    await page.route(parent + "/signing-fixture", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<form action="${signing.origin}/api/mancebo/session" method="post"><input type="hidden" name="ticket" value="${ticket}"><button>Request a signature</button></form>`,
      }),
    );
    await page.goto(parent + "/signing-fixture");
    await page.getByRole("button", { name: "Request a signature" }).click();
    await expect(page).toHaveURL(/\/envelopes\/new$/);
    await expect(
      page.getByRole("link", { name: "Mancebo Document Signing", exact: true }),
    ).toBeVisible();
    expect(
      (await page.context().cookies()).some(
        (cookie) =>
          cookie.name.startsWith("mancebo-signing-") &&
          cookie.httpOnly &&
          cookie.domain === "localhost",
      ),
    ).toBe(true);

    const replay = await request.post("/api/mancebo/session", {
      headers: { Origin: parent },
      form: { ticket },
      maxRedirects: 0,
    });
    expect(replay.status()).toBe(303);
    expect(replay.headers().location).toBe(
      parent + "/documents?connection=retry",
    );
    expect(replay.headers()["set-cookie"]).toBeUndefined();

    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 20_000 }),
      page.getByRole("button", { name: "Document upload dropzone" }).click(),
    ]);
    const pdfPath = await writeSamplePdf(info.outputPath("agreement.pdf"));
    await chooser.setFiles(pdfPath);
    await expect(
      page.getByText("agreement.pdf", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Envelope title").fill("Private test agreement");
    await page.getByRole("button", { name: "Next ->" }).click();
    await expect(page).toHaveURL(/\/envelopes\/[^/]+\/signers$/);
    const draftPath = new URL(page.url()).pathname;
    const documentPath = "/api" + draftPath.replace(/\/signers$/, "/document");
    const ownPdf = await page.request.get(signing.origin + documentPath);
    expect(ownPdf.status()).toBe(200);
    expect(await ownPdf.body()).toEqual(await readFile(pdfPath));
    const other = await browser.newContext({ baseURL });
    try {
      const next = await issue(request, second, "documents");
      const authenticated = await other.request.post("/api/mancebo/session", {
        headers: { Origin: parent },
        form: { ticket: next },
        maxRedirects: 0,
      });
      expect(authenticated.headers().location).toBe("/dashboard");
      const secondPage = await other.newPage();
      await secondPage.goto("/dashboard");
      await expect(secondPage).toHaveURL(/\/dashboard$/);
      await secondPage.goto(draftPath);
      await expect(secondPage.getByLabel("Signer 1 name")).toHaveCount(0);
      await expect(
        secondPage.getByText("Private test agreement", { exact: true }),
      ).toHaveCount(0);
      const privatePdf = await other.request.get(documentPath);
      expect(privatePdf.status()).toBe(404);
    } finally {
      await other.close();
    }
  } finally {
    signing.close();
    await database.end();
  }
});
