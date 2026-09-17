import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const SOURCE_CATEGORIES = ["메인반찬", "밑반찬", "국/탕", "찌개", "면/만두", "밥/죽/떡"];
type CatalogMenu = { sourceCategory: string; baseName: string; cookingMethods: string };

function readCatalogMenus() {
  const catalogPath = process.env.MEAL_CATALOG_DB_PATH
    ?? join(process.env.MEAL_PLAN_ROOT || process.cwd(), "data", "10000recipe-catalog.db");
  if (!existsSync(catalogPath)) throw new Error("만개의레시피 카탈로그를 찾지 못했습니다.");
  const catalog = new DatabaseSync(catalogPath, { readOnly: true });
  try {
    return catalog.prepare(`SELECT "sourceCategory", "name" AS "baseName", "cookingMethods"
      FROM "RecipeCatalogMenu" ORDER BY "sourceCategory", "name"`).all() as CatalogMenu[];
  } finally {
    catalog.close();
  }
}

export async function GET() {
  try {
    const [menus, saved] = await Promise.all([
      Promise.resolve(readCatalogMenus()),
      prisma.catalogMenuWeight.findMany(),
    ]);
    const weights = new Map(saved.map(item => [`${item.sourceCategory}|${item.baseName}`, item.weightPercent]));
    return NextResponse.json({
      defaultWeightPercent: 100,
      minWeightPercent: 0,
      maxWeightPercent: 500,
      menus: menus.map(menu => ({
        sourceCategory: menu.sourceCategory,
        baseName: menu.baseName,
        cookingMethods: JSON.parse(menu.cookingMethods) as string[],
        weightPercent: weights.get(`${menu.sourceCategory}|${menu.baseName}`) ?? 100,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "가중치 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { updates?: unknown[] };
    if (!Array.isArray(body.updates) || body.updates.length < 1 || body.updates.length > 180)
      throw new Error("저장할 기본메뉴를 1~180개 선택해 주세요.");
    const catalogKeys = new Set(readCatalogMenus().map(menu => `${menu.sourceCategory}|${menu.baseName}`));
    const updates = body.updates.map((raw) => {
      const item = raw as { sourceCategory?: unknown; baseName?: unknown; weightPercent?: unknown };
      const sourceCategory = String(item.sourceCategory ?? "").trim();
      const baseName = String(item.baseName ?? "").trim();
      const weightPercent = Number(item.weightPercent);
      if (!SOURCE_CATEGORIES.includes(sourceCategory) || !catalogKeys.has(`${sourceCategory}|${baseName}`))
        throw new Error("카탈로그에 있는 기본메뉴만 설정할 수 있습니다.");
      if (!Number.isInteger(weightPercent) || weightPercent < 0 || weightPercent > 500)
        throw new Error("가중치는 0~500 사이의 정수로 입력해 주세요.");
      return { sourceCategory, baseName, weightPercent };
    });
    await prisma.$transaction(async tx => {
      for (const item of updates) {
        const where = { sourceCategory_baseName: { sourceCategory: item.sourceCategory, baseName: item.baseName } };
        if (item.weightPercent === 100) await tx.catalogMenuWeight.deleteMany({ where: where.sourceCategory_baseName });
        else await tx.catalogMenuWeight.upsert({ where, create: item, update: { weightPercent: item.weightPercent } });
      }
    });
    return NextResponse.json({
      success: true,
      count: updates.length,
      message: `${updates.length}개 기본메뉴의 가중치를 저장했습니다. 기존 식단은 유지하고 다음 자동 생성부터 반영합니다.`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "가중치를 저장하지 못했습니다." }, { status: 400 });
  }
}
