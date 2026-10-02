export const REVIEW_UNIT: string;

export function parseExactServings(value: unknown): number | null;

export function parseCatalogIngredient(value: unknown, category?: string): {
  name: string;
  quantity: number;
  unit: string;
  category: string;
} | null;

export function scaleCatalogRecipe(row: {
  servingsText?: string | null;
  sourceUrl?: string | null;
  ingredientGroups?: string | null;
} | null, targetServings: number, banned?: string[]): {
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
    category: string;
    quantityNote?: string;
  }> | null;
  reason: string | null;
};
