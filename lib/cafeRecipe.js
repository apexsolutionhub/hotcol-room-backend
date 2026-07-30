/** Café recipe / profit math — mirrors hotcol-user lib/cafeRecipe.js */

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseMenuRecipe(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ingredients = raw.ingredients;
  if (!Array.isArray(ingredients) || ingredients.length === 0) return null;

  const parsed = [];
  for (const row of ingredients) {
    if (!row || typeof row !== "object") continue;
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    parsed.push({
      name,
      amount: asNumber(row.amount),
      measuredBy: String(row.measuredBy ?? "").trim(),
      unitPrice: asNumber(row.unitPrice),
    });
  }
  return parsed.length > 0 ? { ingredients: parsed } : null;
}

export function recipeCostPerUnit(recipe) {
  return recipe.ingredients.reduce(
    (sum, line) => sum + line.amount * line.unitPrice,
    0,
  );
}

export function findItemRecipeByTitle(items, title) {
  const key = String(title ?? "").trim().toLowerCase();
  if (!key) return null;
  const item = items.find(
    (i) => String(i.name ?? "").trim().toLowerCase() === key,
  );
  return item ? parseMenuRecipe(item.recipeJson) : null;
}

/** Per-serving ingredient cost to freeze on the order at sale time. */
export function unitCostAtSaleFromItems(items, title) {
  const recipe = findItemRecipeByTitle(items, title);
  if (!recipe) return null;
  const cost = recipeCostPerUnit(recipe);
  return Number.isFinite(cost) ? cost : null;
}
