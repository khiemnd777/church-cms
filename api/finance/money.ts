import { Decimal128 } from "mongodb";
import { requireCondition } from "../errors";
export const MAX_AMOUNT = 999999999999999999n;
export const moneyValue = (value: string) => {
  requireCondition(/^[1-9]\d{0,17}$/.test(value), 422, "FINANCE_AMOUNT_INVALID");
  const n = BigInt(value);
  requireCondition(n <= MAX_AMOUNT, 422, "FINANCE_AMOUNT_INVALID");
  return n;
};
export const moneyDecimal = (value: bigint | string) => Decimal128.fromString(String(value));
// Decimal128 may emit exponent notation. Expand using integer arithmetic only.
export function decimalString(value: Decimal128): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]?\d+))?$/i.exec(value.toString());
  requireCondition(match, 503, "DEPENDENCY_UNAVAILABLE");
  const digits = `${match[2]}${match[3] ?? ""}`,
    exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  requireCondition(
    Number.isInteger(exponent) && Math.abs(exponent) <= 6144,
    503,
    "DEPENDENCY_UNAVAILABLE",
  );
  let n = BigInt(digits);
  if (exponent >= 0) n *= 10n ** BigInt(exponent);
  else {
    const divisor = 10n ** BigInt(-exponent);
    requireCondition(n % divisor === 0n, 503, "DEPENDENCY_UNAVAILABLE");
    n /= divisor;
  }
  return `${match[1] === "-" && n !== 0n ? "-" : ""}${n}`;
}
