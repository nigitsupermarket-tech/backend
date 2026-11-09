// backend/src/utils/barcode.ts
//
// ONE place that decides what a stored barcode looks like.
//
// WHY THIS EXISTS
// ────────────────────────────────────────────────────────────────────────
// A product ending up with a barcode like "8000810101937.00" can never be
// scanned: the scanner reads "8000810101937" and every lookup (server
// `GET /products?barcode=` and the POS offline cache) is an exact match.
//
// The ".00" comes from spreadsheets. The product importer reads Excel
// cells as their *displayed* text (`raw: false`), so a barcode column
// formatted as a number with 2 decimals — or a CSV that was opened and
// re-saved in Excel — hands us "8000810101937.00". Nothing normalized it
// on the way into the database, so it was stored verbatim.
//
// Every path that writes or looks up a barcode now goes through here.

import { AppError } from "./appError";

// Invisible characters that survive copy/paste and scanner input.
const INVISIBLES = /[​-‍﻿ \r\n\t]/g;
// "123456.00" / "123456.0" — digits then a decimal part that is all zeros.
const TRAILING_ZERO_DECIMAL = /^(\d+)\.0+$/;
// Excel's General format turns long numbers into "8.00081E+12". The real
// digits are already gone at that point, so this can't be repaired.
const SCIENTIFIC = /^\d+(\.\d+)?e[+-]?\d+$/i;

/**
 * Canonical form of a barcode: trimmed, invisible characters removed,
 * spreadsheet ".00" artefact stripped. Returns null for empty input.
 * Throws (400) for Excel scientific notation, which has lost its digits.
 * Anything that isn't a plain "digits.000" case is returned untouched
 * (leading zeros preserved, alphanumeric codes preserved).
 */
export function normalizeBarcode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(INVISIBLES, "").trim();
  if (!cleaned) return null;

  if (SCIENTIFIC.test(cleaned)) {
    throw new AppError(
      `Barcode "${cleaned}" is in scientific notation (Excel shortened it and the real digits are lost). ` +
        `Format the barcode column as Text in your spreadsheet and re-enter the code.`,
      400,
    );
  }

  const m = TRAILING_ZERO_DECIMAL.exec(cleaned);
  return m ? m[1] : cleaned;
}

/**
 * Values to match when looking a scanned code up in the database. The first
 * entry is the canonical code; the extras also match rows that still carry
 * the legacy ".00"/".0" suffix, so scanning works even before the cleanup
 * script has been run. Non-numeric codes get no variants.
 */
export function barcodeLookupVariants(scanned: unknown): string[] {
  let code: string | null;
  try {
    code = normalizeBarcode(scanned);
  } catch {
    code = String(scanned ?? "").trim() || null;
  }
  if (!code) return [];
  return /^\d+$/.test(code) ? [code, `${code}.00`, `${code}.0`] : [code];
}

export interface BarcodeRecord {
  id: string;
  barcode: string | null;
}
export interface BarcodeFix {
  id: string;
  from: string;
  to: string;
}
export interface BarcodeCleanupPlan {
  /** Safe to apply. */
  fixes: BarcodeFix[];
  /** Stripping would duplicate a barcode already in use (or another fix). Left untouched. */
  collisions: Array<BarcodeFix & { reason: string }>;
  /** Non-digit junk (backticks, letters, spaces…) that is NOT a .00 case. Reported only. */
  suspicious: BarcodeRecord[];
}

/**
 * Pure planning step for the cleanup script (no database access, so it can
 * be unit-tested). `existing` = every barcode currently in use anywhere
 * (products + variations) so a fix never creates a duplicate.
 */
export function planBarcodeCleanup(
  records: BarcodeRecord[],
  existing: Set<string>,
): BarcodeCleanupPlan {
  const candidates: BarcodeFix[] = [];
  const suspicious: BarcodeRecord[] = [];

  for (const r of records) {
    if (!r.barcode) continue;
    if (TRAILING_ZERO_DECIMAL.test(r.barcode.trim())) {
      candidates.push({
        id: r.id,
        from: r.barcode,
        to: r.barcode.trim().replace(TRAILING_ZERO_DECIMAL, "$1"),
      });
    } else if (/\D/.test(r.barcode)) {
      suspicious.push(r);
    }
  }

  // Count how many candidates want each target, to catch fix-vs-fix clashes.
  const wanted = new Map<string, number>();
  for (const c of candidates) wanted.set(c.to, (wanted.get(c.to) ?? 0) + 1);

  const fixes: BarcodeFix[] = [];
  const collisions: BarcodeCleanupPlan["collisions"] = [];
  for (const c of candidates) {
    if (existing.has(c.to)) {
      collisions.push({ ...c, reason: `"${c.to}" is already used by another record` });
    } else if ((wanted.get(c.to) ?? 0) > 1) {
      collisions.push({ ...c, reason: `several records would all become "${c.to}"` });
    } else {
      fixes.push(c);
    }
  }
  return { fixes, collisions, suspicious };
}
