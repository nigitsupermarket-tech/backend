// Run: npx tsx tests/barcode.test.ts
import assert from "node:assert/strict";
import {
  normalizeBarcode,
  barcodeLookupVariants,
  planBarcodeCleanup,
} from "../src/utils/barcode";

// ── normalizeBarcode ────────────────────────────────────────────────
assert.equal(normalizeBarcode("8000810101937.00"), "8000810101937");
assert.equal(normalizeBarcode("8000810101937.0"), "8000810101937");
assert.equal(normalizeBarcode("8000810101937.000"), "8000810101937");
assert.equal(normalizeBarcode(8000810101937), "8000810101937"); // numeric cell
assert.equal(normalizeBarcode("  6215000474650 \r\n"), "6215000474650");
assert.equal(normalizeBarcode("​6215000474650"), "6215000474650");
assert.equal(normalizeBarcode("6215000474650"), "6215000474650"); // untouched
assert.equal(normalizeBarcode("00123.00"), "00123"); // leading zeros kept
assert.equal(normalizeBarcode(""), null);
assert.equal(normalizeBarcode("   "), null);
assert.equal(normalizeBarcode(null), null);
assert.equal(normalizeBarcode(undefined), null);
// not a trailing-zero decimal → must NOT be altered
assert.equal(normalizeBarcode("12.50"), "12.50");
assert.equal(normalizeBarcode("ABC-1.00"), "ABC-1.00");
assert.equal(normalizeBarcode("4fwfdv23"), "4fwfdv23");
// Excel scientific-notation damage is unrecoverable → must throw
assert.throws(() => normalizeBarcode("8.00081E+12"), /scientific notation/i);
assert.throws(() => normalizeBarcode("6.215E+12"), /scientific notation/i);

// ── barcodeLookupVariants (scan lookup works even before DB cleanup) ──
assert.deepEqual(barcodeLookupVariants("8000810101937\n"), [
  "8000810101937",
  "8000810101937.00",
  "8000810101937.0",
]);
assert.deepEqual(barcodeLookupVariants(""), []);
assert.deepEqual(barcodeLookupVariants("ABC"), ["ABC"]); // non-numeric: no variants

// ── planBarcodeCleanup ──────────────────────────────────────────────
const plan = planBarcodeCleanup(
  [
    { id: "p1", barcode: "111.00" },
    { id: "p2", barcode: "222.00" },
    { id: "p3", barcode: "333" }, // already clean → ignored
    { id: "p4", barcode: "444.00" },
    { id: "p5", barcode: "444.0" }, // both strip to 444 → collision with each other
    { id: "p6", barcode: "555.00" },
    { id: "p7", barcode: null },
    { id: "p8", barcode: "`8005358000087" }, // junk, not a .00 case
  ],
  new Set(["222", "333"]), // "222" already used elsewhere
);
assert.deepEqual(plan.fixes.map((f) => [f.id, f.to]), [["p1", "111"], ["p6", "555"]]);
assert.deepEqual(plan.collisions.map((c) => c.id).sort(), ["p2", "p4", "p5"]);
assert.deepEqual(plan.suspicious.map((s) => s.id), ["p8"]);
console.log("✅ barcode tests passed");
