export const EXPENSE_CATEGORIES = [
  { value: "meals", label: "Meals", color: "var(--color-chart-1)" },
  { value: "lodging", label: "Lodging", color: "var(--color-chart-2)" },
  { value: "transportation", label: "Transportation", color: "var(--color-chart-3)" },
  { value: "fuel", label: "Fuel", color: "var(--color-chart-4)" },
  { value: "entertainment", label: "Entertainment", color: "var(--color-chart-5)" },
  { value: "office_supplies", label: "Office Supplies", color: "var(--color-chart-6)" },
  { value: "client_entertainment", label: "Client Entertainment", color: "var(--color-chart-7)" },
  { value: "other", label: "Other", color: "var(--color-chart-8)" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label])
) as Record<ExpenseCategory, string>;

export const CATEGORY_COLOR: Record<ExpenseCategory, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.color])
) as Record<ExpenseCategory, string>;

export function formatMoney(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}
