// backend/src/utils/spreadsheetParser.ts
//
// Parses a bulk-recipient spreadsheet (CSV, XLS, XLSX — anything SheetJS can
// read) and extracts "name" + "email" columns regardless of:
//   - capitalisation ("Email", "EMAIL", "email" all match)
//   - column position / how many other columns exist
//   - surrounding whitespace in header names
//
// A handful of common header aliases are also recognised (e.g. "e-mail",
// "full name", "customer name") since real-world exports rarely use the
// exact word "email" or "name".

import * as XLSX from "xlsx";
import { AppError } from "./appError";

export interface ParsedRecipient {
  name: string;
  email: string;
}

export interface SkippedRow {
  row: number; // 1-indexed, matches spreadsheet row (header = row 1)
  reason: string;
  data?: Record<string, unknown>;
}

export interface ParseResult {
  recipients: ParsedRecipient[];
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  skipped: SkippedRow[];
}

const EMAIL_HEADER_ALIASES = ["email", "e-mail", "emailaddress", "mail"];
const NAME_HEADER_ALIASES = [
  "name",
  "fullname",
  "customername",
  "recipientname",
  "contactname",
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalises a header string for comparison: lowercase, strip spaces/underscores/dashes. */
function normalizeHeader(header: unknown): string {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/**
 * Given the row of header cells, find the column index whose normalised
 * name matches one of the provided aliases. Returns -1 if not found.
 */
function findColumnIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parses a spreadsheet buffer (CSV, XLS, or XLSX) and extracts recipient
 * name + email pairs from whichever columns are headed "name" / "email"
 * (or a recognised alias), case-insensitively, no matter where those
 * columns sit or how many other columns surround them.
 */
export function parseRecipientsFromSpreadsheet(
  buffer: Buffer,
  originalFilename?: string,
): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    throw new AppError(
      "Could not read this file. Please upload a valid CSV, XLS, or XLSX file.",
      400,
    );
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new AppError("The uploaded spreadsheet has no sheets.", 400);
  }
  const sheet = workbook.Sheets[sheetName];

  // header: 1 → array-of-arrays so we control column detection ourselves
  // instead of trusting SheetJS's auto-generated object keys (which are
  // case-sensitive and break if two headers only differ by case).
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  if (rows.length === 0) {
    throw new AppError("The uploaded spreadsheet is empty.", 400);
  }

  const headerRow = (rows[0] || []).map((h) => String(h ?? ""));
  const emailColIdx = findColumnIndex(headerRow, EMAIL_HEADER_ALIASES);
  const nameColIdx = findColumnIndex(headerRow, NAME_HEADER_ALIASES);

  if (emailColIdx === -1) {
    throw new AppError(
      `Couldn't find an "Email" column in ${originalFilename || "the uploaded file"}. Make sure one of the columns is headed "Email".`,
      400,
    );
  }

  const dataRows = rows.slice(1);
  const recipients: ParsedRecipient[] = [];
  const skipped: SkippedRow[] = [];
  const seenEmails = new Set<string>();
  let duplicateCount = 0;

  dataRows.forEach((row, i) => {
    const rowNumber = i + 2; // +1 for header, +1 for 1-indexing
    const rawEmail = row[emailColIdx];
    const email = String(rawEmail ?? "")
      .trim()
      .toLowerCase();
    const rawName = nameColIdx !== -1 ? row[nameColIdx] : "";
    const name = String(rawName ?? "").trim();

    if (!email) {
      skipped.push({ row: rowNumber, reason: "Missing email" });
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      skipped.push({
        row: rowNumber,
        reason: `Invalid email format: "${email}"`,
      });
      return;
    }
    if (seenEmails.has(email)) {
      duplicateCount++;
      skipped.push({
        row: rowNumber,
        reason: `Duplicate of an earlier row: ${email}`,
      });
      return;
    }

    seenEmails.add(email);
    recipients.push({
      name: name || email.split("@")[0],
      email,
    });
  });

  return {
    recipients,
    totalRows: dataRows.length,
    validCount: recipients.length,
    duplicateCount,
    skipped,
  };
}

/** Allowed file extensions/mimetypes for the multer fileFilter. */
export const SPREADSHEET_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/csv",
  "text/plain", // some browsers send CSV as text/plain
  "application/octet-stream", // fallback some browsers/OSes use for .xlsx
];

const SPREADSHEET_EXTENSIONS = [".csv", ".xls", ".xlsx"];

export function isAllowedSpreadsheetFile(file: Express.Multer.File): boolean {
  const nameLower = file.originalname.toLowerCase();
  const hasAllowedExt = SPREADSHEET_EXTENSIONS.some((ext) =>
    nameLower.endsWith(ext),
  );
  return hasAllowedExt || SPREADSHEET_MIME_TYPES.includes(file.mimetype);
}

// ─── Phone-number recipients (for bulk SMS) ────────────────────────────────

export interface ParsedPhoneRecipient {
  name: string;
  phone: string;
}

const PHONE_HEADER_ALIASES = [
  "phone",
  "phonenumber",
  "mobile",
  "mobilenumber",
  "tel",
  "telephone",
  "contact",
  "contactnumber",
  "cell",
  "cellphone",
  "whatsapp",
];

/**
 * Normalises a Nigerian-style phone number into the digits-only, country-code
 * form most SMS providers (Termii included) expect: "234XXXXXXXXXX".
 * Falls back to stripping non-digits for other formats (e.g. already-international).
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.startsWith("0") && digits.length === 11) {
    return "234" + digits.slice(1);
  }
  if (digits.startsWith("234")) return digits;
  return digits;
}

function isPlausiblePhone(digits: string): boolean {
  return /^\d{10,15}$/.test(digits);
}

/**
 * Parses a spreadsheet buffer (CSV, XLS, or XLSX) and extracts recipient
 * name + phone pairs from whichever columns are headed "phone" / "mobile" /
 * etc. (case-insensitive, alias-aware), independent of column order.
 */
export function parsePhoneRecipientsFromSpreadsheet(
  buffer: Buffer,
  originalFilename?: string,
): {
  recipients: ParsedPhoneRecipient[];
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  skipped: SkippedRow[];
} {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new AppError(
      "Could not read this file. Please upload a valid CSV, XLS, or XLSX file.",
      400,
    );
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName)
    throw new AppError("The uploaded spreadsheet has no sheets.", 400);
  const sheet = workbook.Sheets[sheetName];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  if (rows.length === 0)
    throw new AppError("The uploaded spreadsheet is empty.", 400);

  const headerRow = (rows[0] || []).map((h) => String(h ?? ""));
  const phoneColIdx = findColumnIndex(headerRow, PHONE_HEADER_ALIASES);
  const nameColIdx = findColumnIndex(headerRow, NAME_HEADER_ALIASES);

  if (phoneColIdx === -1) {
    throw new AppError(
      `Couldn't find a "Phone" column in ${originalFilename || "the uploaded file"}. Make sure one of the columns is headed "Phone" (or "Mobile").`,
      400,
    );
  }

  const dataRows = rows.slice(1);
  const recipients: ParsedPhoneRecipient[] = [];
  const skipped: SkippedRow[] = [];
  const seenPhones = new Set<string>();
  let duplicateCount = 0;

  dataRows.forEach((row, i) => {
    const rowNumber = i + 2;
    const rawPhone = row[phoneColIdx];
    const rawName = nameColIdx !== -1 ? row[nameColIdx] : "";
    const name = String(rawName ?? "").trim();
    const originalEntry = String(rawPhone ?? "").trim();

    if (!originalEntry) {
      skipped.push({ row: rowNumber, reason: "Missing phone number" });
      return;
    }

    const normalized = normalizePhone(originalEntry);
    if (!isPlausiblePhone(normalized)) {
      skipped.push({
        row: rowNumber,
        reason: `Invalid phone number: "${originalEntry}"`,
      });
      return;
    }
    if (seenPhones.has(normalized)) {
      duplicateCount++;
      skipped.push({
        row: rowNumber,
        reason: `Duplicate of an earlier row: ${normalized}`,
      });
      return;
    }

    seenPhones.add(normalized);
    recipients.push({ name: name || normalized, phone: normalized });
  });

  return {
    recipients,
    totalRows: dataRows.length,
    validCount: recipients.length,
    duplicateCount,
    skipped,
  };
}
