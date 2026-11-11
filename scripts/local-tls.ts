import { chmod, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
// Private local CA: never install it into the host/global trust store.
export async function localTls(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const ca = join(directory, "root-ca.pem"),
    caKey = join(directory, "root-ca-key.pem"),
    cert = join(directory, "localhost.pem"),
    key = join(directory, "localhost-key.pem"),
    csr = join(directory, "localhost.csr"),
    ext = join(directory, "localhost.ext");
  if (
    (await Bun.file(ca).exists()) &&
    (await Bun.file(cert).exists()) &&
    (await Bun.file(key).exists())
  )
    return { ca, cert, key };
  const run = (args: string[]) => {
    if (Bun.spawnSync(["openssl", ...args], { stdout: "ignore", stderr: "ignore" }).exitCode !== 0)
      throw new Error("Local TLS generation failed");
  };
  run([
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-nodes",
    "-keyout",
    caKey,
    "-out",
    ca,
    "-days",
    "365",
    "-subj",
    "/CN=Church CMS local CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  run([
    "req",
    "-new",
    "-newkey",
    "rsa:3072",
    "-nodes",
    "-keyout",
    key,
    "-out",
    csr,
    "-subj",
    "/CN=localhost",
  ]);
  await Bun.write(
    ext,
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n",
  );
  run([
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    ca,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    cert,
    "-days",
    "30",
    "-sha256",
    "-extfile",
    ext,
  ]);
  await chmod(caKey, 0o600);
  await chmod(key, 0o600);
  await unlink(csr);
  await unlink(ext);
  return { ca, cert, key };
}
