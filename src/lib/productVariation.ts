// backend/src/lib/productVariation.ts
//
// Shared logic for pricing and stock resolution of a Product's structured
// `variations` (dynamic presets — e.g. "500g Pack", "1kg Bag"). Used by
// every write path that can sell a variation: cart, online checkout, and
// POS (create/void/resume) — so the pricing/stock rules stay identical no
// matter which channel the sale came through.
//
// Terminology used everywhere a variation is involved:
//   - "pack count" — the `quantity` stored on a Cart/Order/POS item when
//     variationId is set. It means "how many of this preset", e.g. 3 packs
//     of "500g Pack" — NOT a raw scale amount.
//   - "base qty"    — pack count × variation.quantity, expressed in the
//     parent product's scaleUnit (e.g. 3 × 0.5kg = 1.5kg). This is what
//     gets deducted from the SHARED product.stockQuantity pool.

import { AppError, NotFoundError } from "../utils/appError";

export type StockMode = "SHARED" | "DEDICATED";

export interface VariationLike {
  id: string;
  productId: string;
  label: string;
  quantity: number;
  price: number;
  stockQuantity: number | null;
  isActive: boolean;
}

export interface ProductLike {
  id: string;
  name: string;
  isScalable: boolean;
  scaleUnit: string | null;
  trackInventory: boolean;
  stockQuantity: number;
  variations?: VariationLike[];
}

export interface ResolvedVariationLine {
  variationId: string;
  variationLabel: string;
  stockMode: StockMode;
  unitPrice: number; // price for ONE pack
  subtotal: number; // unitPrice × packCount
  packCount: number;
  baseQty: number; // packCount × variation.quantity — for SHARED deduction / weight calcs
}

/**
 * Finds an ACTIVE variation on a product by id, throwing a friendly error
 * if it's missing, disabled, or doesn't belong to the product.
 */
export function findActiveVariation(
  product: ProductLike,
  variationId: string,
): VariationLike {
  const variation = product.variations?.find((v) => v.id === variationId);
  if (!variation) {
    throw new NotFoundError(
      `Selected option for ${product.name} is no longer available`,
    );
  }
  if (!variation.isActive) {
    throw new AppError(
      `"${variation.label}" for ${product.name} is currently unavailable`,
      400,
    );
  }
  return variation;
}

/**
 * Resolves authoritative price + stock requirements for a variation line.
 * Price always comes from the variation record server-side (never trusts a
 * client-supplied unitPrice) so POS/checkout totals can't be tampered with.
 */
export function resolveVariationLine(
  variation: VariationLike,
  packCount: number,
): ResolvedVariationLine {
  const safePackCount = packCount > 0 ? packCount : 1;
  const stockMode: StockMode =
    variation.stockQuantity !== null && variation.stockQuantity !== undefined
      ? "DEDICATED"
      : "SHARED";

  return {
    variationId: variation.id,
    variationLabel: variation.label,
    stockMode,
    unitPrice: variation.price,
    subtotal: parseFloat((variation.price * safePackCount).toFixed(2)),
    packCount: safePackCount,
    baseQty: parseFloat((variation.quantity * safePackCount).toFixed(6)),
  };
}

/**
 * Validates that enough stock exists for a resolved variation line, given
 * the parent product's current shared stock. Throws a friendly AppError if
 * not (unless the product allows backorders).
 */
export function assertVariationStock(
  product: ProductLike,
  variation: VariationLike,
  resolved: ResolvedVariationLine,
  allowBackorder: boolean,
): void {
  if (!product.trackInventory || allowBackorder) return;

  if (resolved.stockMode === "DEDICATED") {
    const available = variation.stockQuantity ?? 0;
    if (available < resolved.packCount) {
      throw new AppError(
        `Insufficient stock for ${product.name} — ${variation.label} (available: ${available})`,
        400,
      );
    }
  } else {
    if (product.stockQuantity < resolved.baseQty) {
      const unit = product.scaleUnit || "unit";
      throw new AppError(
        `Insufficient stock for ${product.name} — ${variation.label} (available: ${product.stockQuantity}${unit})`,
        400,
      );
    }
  }
}
