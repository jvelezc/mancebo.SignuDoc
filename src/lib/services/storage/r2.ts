import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import type { EnvSource } from "../../utils/env.ts";
import {
  normalizeStorageKey,
  StorageObjectNotFoundError,
  type StorageService,
} from "./types.ts";

/** Each signing installation uses its own database and fixed Mancebo tenant namespace. */
export function createR2StorageService({
  env = process.env,
  client,
}: {
  env?: EnvSource;
  client?: S3Client;
} = {}): StorageService {
  const account = env.SIGNING_R2_ACCOUNT_ID?.trim();
  const bucketName = env.SIGNING_R2_BUCKET?.trim();
  const tenant = env.MANCEBO_SIGNING_TENANT_ID?.trim().toLowerCase();
  const accessKeyId = env.SIGNING_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.SIGNING_R2_SECRET_ACCESS_KEY?.trim();
  if (
    !account ||
    !/^[a-f0-9]{32}$/.test(account) ||
    !bucketName ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName) ||
    !tenant ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(tenant) ||
    tenant === "00000000-0000-0000-0000-000000000000" ||
    !accessKeyId ||
    !secretAccessKey
  ) {
    throw new Error("Private signing storage is not configured.");
  }
  const s3 = client ?? configuredClient(account, accessKeyId, secretAccessKey);
  const prefix = "tenants/" + tenant + "/signing/";
  function location(key: string) {
    const logicalKey = normalizeStorageKey(key);
    return {
      logicalKey,
      request: { Bucket: bucketName, Key: prefix + logicalKey },
    };
  }

  return {
    async putObject({ body, contentType, key, keepExisting }) {
      const { logicalKey, request } = location(key);
      try {
        await s3.send(
          new PutObjectCommand({
            ...request,
            Body: body,
            ContentType: contentType,
            ...(keepExisting ? { IfNoneMatch: "*" } : {}),
          }),
        );
      } catch (error) {
        if (!(keepExisting && hasStatus(error, 412))) throw error;
      }
      return { bucketName, key: logicalKey };
    },
    async getObject(key) {
      const { logicalKey, request } = location(key);
      try {
        const result = await s3.send(new GetObjectCommand(request));
        if (!result.Body)
          throw new Error("Signing storage returned no object body.");
        return {
          bucketName,
          key: logicalKey,
          body: await result.Body.transformToByteArray(),
          contentLength: result.ContentLength,
          contentType: result.ContentType,
          etag: result.ETag,
        };
      } catch (error) {
        if (hasStatus(error, 404))
          throw new StorageObjectNotFoundError(logicalKey);
        throw error;
      }
    },
    async getObjectStream(key) {
      const { logicalKey, request } = location(key);
      try {
        const result = await s3.send(new GetObjectCommand(request));
        if (!result.Body)
          throw new Error("Signing storage returned no object body.");
        return {
          bucketName,
          key: logicalKey,
          stream: result.Body.transformToWebStream(),
          contentLength: result.ContentLength,
          contentType: result.ContentType,
        };
      } catch (error) {
        if (hasStatus(error, 404))
          throw new StorageObjectNotFoundError(logicalKey);
        throw error;
      }
    },
    async headObject(key) {
      const { logicalKey, request } = location(key);
      try {
        const result = await s3.send(new HeadObjectCommand(request));
        return {
          bucketName,
          key: logicalKey,
          exists: true,
          contentLength: result.ContentLength,
          contentType: result.ContentType,
          etag: result.ETag,
        };
      } catch (error) {
        if (!hasStatus(error, 404)) throw error;
        return { bucketName, key: logicalKey, exists: false };
      }
    },
    async deleteObject(key) {
      await s3.send(new DeleteObjectCommand(location(key).request));
    },
  };
}

let sharedClient:
  | {
      account: string;
      accessKeyId: string;
      secretAccessKey: string;
      client: S3Client;
    }
  | undefined;

function configuredClient(
  account: string,
  accessKeyId: string,
  secretAccessKey: string,
) {
  if (
    sharedClient?.account === account &&
    sharedClient.accessKeyId === accessKeyId &&
    sharedClient.secretAccessKey === secretAccessKey
  )
    return sharedClient.client;
  const client = new S3Client({
    endpoint: "https://" + account + ".r2.cloudflarestorage.com",
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  sharedClient = { account, accessKeyId, secretAccessKey, client };
  return client;
}

function hasStatus(error: unknown, status: number) {
  return (
    error instanceof S3ServiceException &&
    error.$metadata.httpStatusCode === status
  );
}
