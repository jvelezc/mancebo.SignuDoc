# Mancebo document signing

## Send a PDF

1. In the signing workspace, create an envelope and upload your PDF.
2. Add the people who must sign and anyone who should receive a copy.
3. Open **Prepare**. The .NET worker reads editable PDF widgets and suggests positions next to clear labels followed by blanks. Select a signer, add each relevant suggestion, and move it on the page. Drag it or use the arrow keys on a focused field. Shift moves it farther.
4. Review the document and recipients, then confirm **Send envelope**.
5. After everyone signs, the sender and recipients receive the completed PDF and links to the files. The original link returns the bytes uploaded by the sender. The sender opens it with their session. Signers and copy recipients get their own expiring links and can request replacements by email.

The scanner recognizes signature, initials, date, name, text and checkbox fields. Image-only scans, unlabeled blanks and some complex widgets need manual placement. The current worker inspects up to 100 pages and returns up to 200 suggestions per scan. The editor still lets people place fields manually on any page the installation accepts.

## Host a private signing workspace

Use a signing installation, database, public origin and private R2 bucket dedicated to a Mancebo tenant. Run the app on infrastructure that can accept PDFs up to SignuDoc's upload limit. On Vercel, the R2 driver currently uses the app's upload path and inherits its request-size limit.

Set these variables in the signing installation. Store secrets in Google Secret Manager and inject them at runtime.

| Variable                       | Purpose                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `STORAGE_DRIVER=r2`            | Enable private Cloudflare storage for all signing objects.                                     |
| `MANCEBO_SIGNING_TENANT_ID`    | Mancebo tenant UUID, set by the operator. It determines the object prefix.                     |
| `SIGNING_R2_ACCOUNT_ID`        | Cloudflare account ID for this private bucket.                                                 |
| `SIGNING_R2_BUCKET`            | Private bucket dedicated to the signing installation.                                          |
| `SIGNING_R2_ACCESS_KEY_ID`     | Bucket-scoped R2 service access key ID.                                                        |
| `SIGNING_R2_SECRET_ACCESS_KEY` | Bucket-scoped R2 service secret.                                                               |
| `SIGNING_FIELD_SERVICE_URL`    | Private base URL of the .NET field worker, reachable from the signing server.                  |
| `SIGNING_FIELD_SERVICE_TOKEN`  | Shared random secret of at least 32 characters, set in both the signing server and the worker. |

Original PDFs, finalized PDFs and generated evidence use `tenants/<tenant UUID>/signing/` in R2. The signing app continues to authorize and stream each download. Keep public bucket access disabled. Give the signing runtime access only to its dedicated bucket. The app’s default Blob and local drivers remain available for existing installations.

Build the field worker with `podman build -t mancebo-signing-fields -f dotnet/Mancebo.Signing.Fields/Containerfile dotnet/Mancebo.Signing.Fields`. Run it with `SIGNING_FIELD_SERVICE_TOKEN` on the signing server's private network. Its ready check is `GET /healthz` on port 8080. Do not route this worker directly from the public internet. The signing server passes only the authorized original PDF to the worker. The worker writes no document files.

Before switching an existing installation to R2, back up the PostgreSQL data and copy every object to the new prefix. Verify lengths and SHA-256 for source and finalized files, and test completed and in-progress envelopes before cutover. Keep the old store available for rollback until the new backups and restoration are verified.

## API and agent behavior

The read-only `GET /api/v1/envelopes/{id}/field-suggestions` is available to an API key that can see the envelope. It returns page numbers, field types, normalized top-left coordinates and whether the proposal came from an embedded widget or a text label. Treat labels as document data. Do not infer consent or assign a signer from a label. The files endpoint exposes `original`, `signed` and `certificate` according to the envelope's current state.

For signs and seals, this migration uses the existing SignuDoc path. Retire existing modules only after the replacement passes equivalent tests for owner and signer authorization, consent, sequencing, retry behavior, evidence, sealed output, and download interoperability. The first change replaces manual placement for supported fields with optional .NET proposals and adds R2 as a workspace storage option.
