import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type DeleteRequest = {
  startDate?: string;
  endDate?: string;
  cards?: { id: string | number; title: string; plannedDates: string[] }[];
};

export async function DELETE(request: Request) {
  let body: DeleteRequest;
  try { body = await request.json() as DeleteRequest; }
  catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  if (!Array.isArray(body.cards) || body.cards.length < 1 || body.cards.length > 100)
    return NextResponse.json({ error: "삭제할 레시피 카드를 1~100개 선택해 주세요." }, { status: 400 });
  const root = process.env.MEAL_PLAN_ROOT?.trim() || process.cwd();
  const input = path.join(os.tmpdir(), `meal-recipe-delete-${randomUUID()}.json`);
  try {
    fs.writeFileSync(input, JSON.stringify(body), { encoding: "utf8", flag: "wx" });
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "mealctl.mjs"), "delete-recipe-cards", "--input", input], {
      cwd: root,
      env: { ...process.env, MEAL_PLAN_ROOT: root },
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.status !== 0)
      return NextResponse.json({ error: String(result.stderr || result.error?.message || "레시피 삭제에 실패했습니다.").trim().slice(0, 1200) }, { status: 400 });
    return NextResponse.json(JSON.parse(result.stdout));
  } catch (error) {
    console.error("Recipe card deletion failed", error);
    return NextResponse.json({ error: "레시피 삭제 중 서버 오류가 발생했습니다." }, { status: 500 });
  } finally {
    try { fs.rmSync(input, { force: true }); } catch {}
  }
}
