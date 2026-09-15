import { DatabaseSync } from "node:sqlite";

export function catalogCounts(filePath) {
  const catalog = new DatabaseSync(filePath, { readOnly: true });
  try {
    const menus = catalog.prepare('SELECT COUNT(*) AS n FROM "RecipeCatalogMenu"').get().n;
    const variants = catalog.prepare('SELECT COUNT(*) AS n FROM "RecipeCatalogVariant"').get().n;
    if (menus < 1 || variants < 1)
      throw new Error("카탈로그에 기본메뉴 또는 세부메뉴가 없습니다.");
    return { menus, variants };
  } finally {
    catalog.close();
  }
}
