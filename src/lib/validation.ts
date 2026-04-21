/**
 * Small value-validators used across API routes. All return `null` when the
 * input is invalid so callers can compose them into early-return guards
 * without try/catch.
 */

/** Positive-integer drops amount (XRP). Rejects decimals and negatives. */
export function validateDrops(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) return null;
  return value;
}

/** Positive numeric amount (IOU decimal or pre-scaled MPT integer). */
export function validateAmount(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return value;
}

/** Coerce + range-check a numeric input. */
export function validateNumber(
  value: unknown,
  min: number,
  max: number
): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

/** MongoDB ObjectId (24 hex chars). */
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
export function validateObjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!OBJECT_ID_REGEX.test(value.trim())) return null;
  return value.trim();
}

/**
 * Pick the right numeric validator based on asset type. IOU/MPT accept
 * decimal strings; XRP is always integer drops.
 */
export function validateAssetAmount(value: unknown, isToken: boolean): string | null {
  return isToken ? validateAmount(value) : validateDrops(value);
}

/** Trim, cap length, strip control characters. For user-supplied metadata. */
export function sanitizeString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .slice(0, maxLength)
    .replace(/[\x00-\x1F\x7F]/g, "");
}
