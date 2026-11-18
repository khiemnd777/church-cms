import { resolve } from "node:path";
// Regression evidence is opt-in. Never overwrite an earlier package's accepted artifacts.
export async function writeEvidence(
  originalPath: string,
  data: string | Uint8Array | ArrayBuffer | Blob,
) {
  const root = process.env.CHURCH_EVIDENCE_DIR;
  if (!root) return;
  if (!originalPath.startsWith("output/") || originalPath.includes(".."))
    throw new Error("Unexpected evidence path");
  await Bun.write(resolve(root, originalPath.slice("output/".length)), data);
}
