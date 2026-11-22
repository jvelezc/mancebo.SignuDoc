import { once } from "node:events";
import { request } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import forge from "node-forge";

/** Gives Chromium a real HTTPS redirect and a normal cookie jar against local Next.js. */
export async function startSigningHttps(upstream: string) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 3_600_000);
  const name = [{ name: "commonName", value: "localhost" }];
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.setExtensions([
    { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const server = createServer(
    {
      key: forge.pki.privateKeyToPem(keys.privateKey),
      cert: forge.pki.certificateToPem(cert),
    },
    (incoming, outgoing) => {
      const proxy = request(
        upstream + incoming.url,
        {
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      proxy.on("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(proxy);
    },
  );
  server.listen(0, "localhost");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    origin: "https://localhost:" + port,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}
