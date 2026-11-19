import { createHash } from "node:crypto";
import { AppError, requireCondition } from "../errors";

export const expenseImageLimit = 5 * 1024 * 1024;
export type ExpenseImageType = "image/jpeg" | "image/png";

export async function normalizeExpenseImage(bytes: Uint8Array, type: ExpenseImageType) {
  requireCondition(
    bytes.length > 0 && bytes.length <= expenseImageLimit,
    413,
    "EXPENSE_IMAGE_LIMIT",
  );
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  requireCondition(type === "image/jpeg" ? jpeg : png, 422, "EXPENSE_IMAGE_INVALID");
  const { default: sharp } = await import("sharp");
  let output: Buffer;
  try {
    const pipeline = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" })
      .autoOrient()
      .timeout({ seconds: 5 });
    const metadata = await pipeline.metadata();
    requireCondition(
      metadata.format === (jpeg ? "jpeg" : "png") && (metadata.pages ?? 1) === 1,
      422,
      "EXPENSE_IMAGE_INVALID",
    );
    output = await (jpeg ? pipeline.jpeg({ quality: 90 }) : pipeline.png()).toBuffer();
  } catch {
    throw new AppError(422, "EXPENSE_IMAGE_INVALID");
  }
  requireCondition(output.length <= expenseImageLimit, 413, "EXPENSE_IMAGE_LIMIT");
  return { bytes: output, type, hash: createHash("sha256").update(output).digest("hex") };
}

export function expenseImageFilename(type: ExpenseImageType) {
  return type === "image/jpeg" ? "chung-tu.jpg" : "chung-tu.png";
}
