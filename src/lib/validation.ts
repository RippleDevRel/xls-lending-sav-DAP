// Validate a string amount in drops is a valid positive integer
export function validateDrops(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) return null;
  return value;
}

// Validate a string amount (positive number, integer or decimal — for IOU/MPT)
export function validateAmount(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return value;
}

// Validate a numeric parameter is within range
export function validateNumber(
  value: unknown,
  min: number,
  max: number
): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

// Validate an XRPL classic address (r...)
const XRPL_ADDRESS_REGEX = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
export function validateXrplAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!XRPL_ADDRESS_REGEX.test(value.trim())) return null;
  return value.trim();
}

// Validate a 3-character currency code or 40-hex for non-standard
const CURRENCY_REGEX = /^[A-Z]{3}$|^[0-9A-F]{40}$/;
export function validateCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  if (!CURRENCY_REGEX.test(v)) return null;
  return v;
}

// Validate MPT issuance ID (48-char hex)
const MPT_ID_REGEX = /^[0-9A-Fa-f]{48}$/;
export function validateMptIssuanceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!MPT_ID_REGEX.test(v)) return null;
  return v;
}

// Validate a MongoDB ObjectId string
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
export function validateObjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!OBJECT_ID_REGEX.test(value.trim())) return null;
  return value.trim();
}

// Sanitize a plain text string (trim, limit length, strip control chars)
export function sanitizeString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .slice(0, maxLength)
    .replace(/[\x00-\x1F\x7F]/g, "");
}
