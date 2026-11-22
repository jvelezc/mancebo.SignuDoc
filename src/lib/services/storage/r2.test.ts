import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createR2StorageService } from "./r2.ts";
import { StorageObjectNotFoundError } from "./types.ts";

const settings = {
  MANCEBO_SIGNING_TENANT_ID: "3ef91fa2-1d2d-4284-8998-de2c83a6adda",
  SIGNING_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  SIGNING_R2_BUCKET: "workspace-pdfs",
  SIGNING_R2_ACCESS_KEY_ID: "fake-key",
  SIGNING_R2_SECRET_ACCESS_KEY: "fake-secret",
};

test("R2 keys stay in the installation tenant and conditional writes cannot replace an existing PDF", async () => {
  type Command =
    | PutObjectCommand
    | HeadObjectCommand
    | GetObjectCommand
    | DeleteObjectCommand;
  const commands: Command[] = [];
  const connection = {
    async send(command: Command) {
      commands.push(command);
      if (command instanceof PutObjectCommand)
        throw new S3ServiceException({
          name: "PreconditionFailed",
          $fault: "client",
          $metadata: { httpStatusCode: 412 },
        });
      if (
        command instanceof HeadObjectCommand ||
        command instanceof GetObjectCommand
      )
        throw new S3ServiceException({
          name: "NotFound",
          $fault: "client",
          $metadata: { httpStatusCode: 404 },
        });
      return {};
    },
  } as unknown as S3Client;
  const storage = createR2StorageService({ env: settings, client: connection });
  const key = "envelopes/receipt.pdf";
  const location = await storage.putObject({
    body: new Uint8Array([1]),
    contentType: "application/pdf",
    key,
    keepExisting: true,
  });
  assert.deepEqual(location, { bucketName: settings.SIGNING_R2_BUCKET, key });
  assert.ok(commands[0] instanceof PutObjectCommand);
  assert.equal(commands[0].input.IfNoneMatch, "*");
  assert.equal((await storage.headObject(key)).exists, false);
  await assert.rejects(
    storage.getObjectStream(key),
    StorageObjectNotFoundError,
  );
  await storage.deleteObject(key);
  for (const command of commands) {
    assert.equal(command.input.Bucket, settings.SIGNING_R2_BUCKET);
    assert.equal(
      command.input.Key,
      "tenants/" + settings.MANCEBO_SIGNING_TENANT_ID + "/signing/" + key,
    );
  }
  await assert.rejects(storage.getObject("../another-tenant/pdf"), /invalid/);
  assert.equal(commands.length, 4);
});
