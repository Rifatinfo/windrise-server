/**
 * Pricing calculator maths.
 *
 * Mirrored on the client in `windrise-client/src/utils/pricing.ts`, which is
 * what drives the live figures on screen. This copy backs the exported PDF so
 * the two can never disagree. Change one, change the other.
 */

export type CostLine = {
  id: string;
  label: string;
  amount: number;
};

/**
 * Two different things get called "margin", and they give very different
 * prices, so the calculator makes you say which one you mean:
 *
 *   MARGIN — profit as a share of the selling price (the retail standard).
 *            A 25% margin on ৳640 of cost gives ৳853.
 *   MARKUP — profit as a share of cost. A 25% markup on ৳640 gives ৳800.
 *
 * Margin is capped below 100% by definition; markup is not, which is why the
 * slider's ceiling changes with the mode.
 */
export type MarginMode = "MARGIN" | "MARKUP";

export type PlatformFeeMode = "PERCENT" | "FLAT";

export type PricingInput = {
  costs: CostLine[];
  platformFee: number;
  platformFeeMode: PlatformFeeMode;
  marginMode: MarginMode;
  targetMargin: number;
  taxPercent: number;
  /** Round the final price to the nearest multiple. 0 disables rounding. */
  roundTo: number;
  minSellingPrice: number | null;
};

export type PricingTier = {
  key: string;
  label: string;
  margin: number;
  price: number | null;
  profit: number | null;
  isCurrent: boolean;
};

export type PricingResult = {
  totalCost: number;
  sellingPrice: number;
  /** Before rounding and the minimum-price floor. */
  rawPrice: number;
  platformFeeAmount: number;
  taxAmount: number;
  profitPerUnit: number;
  /** Recomputed from the final price, so it can differ from the target. */
  marginAchieved: number;
  markupAchieved: number;
  breakdown: { id: string; label: string; amount: number; percent: number }[];
  warnings: string[];
  roundingApplied: boolean;
  minPriceApplied: boolean;
  /** True when the requested margin cannot be reached at this fee + tax. */
  infeasible: boolean;
};

/** Where the slider stops by default. */
export const MARGIN_MAX = 85;

/** Unlocked by the Custom Margin toggle, for deliberately aggressive pricing. */
export const EXTENDED_MARGIN_MAX = 150;

/**
 * The slider only reaches past 85% once Custom Margin is switched on, so the
 * everyday case cannot be dragged into an extreme by accident.
 */
export const marginCeiling = (useCustomMargin: boolean) =>
  useCustomMargin ? EXTENDED_MARGIN_MAX : MARGIN_MAX;

export const sumCosts = (costs: CostLine[]) =>
  costs.reduce((total, line) => total + (Number.isFinite(line.amount) ? line.amount : 0), 0);

/**
 * The price that leaves `targetMargin` once the platform fee and tax have been
 * taken out — which is what "at your target margin, after platform fee & taxes"
 * has to mean for the headline number to be honest.
 *
 * Solving `price − cost − fee·price − tax·price = margin·price` gives
 * `price = cost / (1 − fee − tax − margin)`.
 */
function solvePrice(input: PricingInput, margin: number): number | null {
  const cost = sumCosts(input.costs);
  const feeRate = input.platformFeeMode === "PERCENT" ? input.platformFee / 100 : 0;
  const flatFee = input.platformFeeMode === "FLAT" ? input.platformFee : 0;
  const taxRate = input.taxPercent / 100;
  const base = cost + flatFee;

  if (input.marginMode === "MARKUP") {
    // Markup is taken on cost, then grossed up so fee and tax come out of the
    // price rather than out of the profit.
    const target = base * (1 + margin / 100);
    const divisor = 1 - feeRate - taxRate;
    if (divisor <= 0) return null;
    return target / divisor;
  }

  const divisor = 1 - feeRate - taxRate - margin / 100;
  if (divisor <= 0) return null;
  return base / divisor;
}

const roundToNearest = (value: number, step: number) =>
  step > 0 ? Math.round(value / step) * step : value;

export function calculatePricing(input: PricingInput): PricingResult {
  const totalCost = sumCosts(input.costs);
  const warnings: string[] = [];

  const raw = solvePrice(input, input.targetMargin);
  const infeasible = raw === null;

  if (infeasible) {
    warnings.push(
      `A ${input.targetMargin}% margin is impossible once the ${input.platformFee}% platform fee and ${input.taxPercent}% tax are taken out — together they exceed 100% of the price.`
    );
  }

  let price = raw ?? 0;
  const beforeRounding = price;
  price = roundToNearest(price, input.roundTo);
  const roundingApplied = input.roundTo > 0 && price !== beforeRounding;

  let minPriceApplied = false;
  if (input.minSellingPrice !== null && price < input.minSellingPrice) {
    price = input.minSellingPrice;
    minPriceApplied = true;
    warnings.push(
      `The calculated price was below your ৳${input.minSellingPrice} floor, so the floor was used instead.`
    );
  }

  // Everything below is derived from the *final* price, so the figures on
  // screen always reconcile with each other.
  const platformFeeAmount =
    input.platformFeeMode === "PERCENT" ? (price * input.platformFee) / 100 : input.platformFee;
  const taxAmount = (price * input.taxPercent) / 100;
  const profitPerUnit = price - totalCost - platformFeeAmount - taxAmount;

  const breakdown = input.costs
    .filter((line) => line.amount > 0)
    .map((line) => ({
      id: line.id,
      label: line.label,
      amount: line.amount,
      percent: totalCost > 0 ? (line.amount / totalCost) * 100 : 0,
    }));

  if (totalCost === 0) {
    warnings.push("Add at least one cost to get a meaningful price.");
  }
  if (!infeasible && profitPerUnit < 0) {
    warnings.push("This price does not cover your costs, fee and tax.");
  }

  return {
    totalCost,
    sellingPrice: price,
    rawPrice: raw ?? 0,
    platformFeeAmount,
    taxAmount,
    profitPerUnit,
    marginAchieved: price > 0 ? (profitPerUnit / price) * 100 : 0,
    markupAchieved: totalCost > 0 ? (profitPerUnit / totalCost) * 100 : 0,
    breakdown,
    warnings,
    roundingApplied,
    minPriceApplied,
    infeasible,
  };
}

/** The comparison table: the same maths run at a handful of margins. */
export function buildTiers(
  input: PricingInput,
  recommendedMargin: number
): PricingTier[] {
  const rows: { key: string; label: string; margin: number }[] = [
    { key: "standard", label: "Standard", margin: 25 },
    { key: "balanced", label: "Balanced", margin: 40 },
    { key: "recommended", label: "Recommended", margin: recommendedMargin },
    { key: "custom", label: "Custom", margin: input.targetMargin },
    { key: "premium", label: "Premium", margin: 100 },
  ];

  const totalCost = sumCosts(input.costs);

  // Two tiers can land on the same number (custom set to the recommended
  // value, say); keep the more specific one rather than showing a duplicate.
  const seen = new Set<number>();

  return rows
    .filter((row) => {
      if (row.key === "custom") return true;
      if (seen.has(row.margin) || row.margin === input.targetMargin) return false;
      seen.add(row.margin);
      return true;
    })
    .sort((a, b) => a.margin - b.margin)
    .map((row) => {
      const solved = solvePrice(input, row.margin);
      if (solved === null) {
        return { ...row, price: null, profit: null, isCurrent: row.key === "custom" };
      }

      const price = roundToNearest(solved, input.roundTo);
      const fee =
        input.platformFeeMode === "PERCENT"
          ? (price * input.platformFee) / 100
          : input.platformFee;
      const tax = (price * input.taxPercent) / 100;

      return {
        ...row,
        price,
        profit: price - totalCost - fee - tax,
        isCurrent: row.key === "custom",
      };
    });
}
