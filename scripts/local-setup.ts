import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { localTls } from "./local-tls";

await localTls(".local");
if (!(await Bun.file(".env").exists())) {
  await writeFile(
    ".env",
    `APP_ORIGIN=https://localhost:3443\nAPP_PORT=3443\nMONGO_URL=mongodb://127.0.0.1:27119/?replicaSet=church-local&directConnection=true\nMONGO_DB=church_cms_local\nREDIS_URL=redis://127.0.0.1:6391\nCSRF_KEY=${randomBytes(48).toString("hex")}\nTLS_CERT=.local/localhost.pem\nTLS_KEY=.local/localhost-key.pem\n`,
    { mode: 0o600, flag: "wx" },
  );
}
console.info("Local config/certificate ready. No global certificate trust or settings changed.");
