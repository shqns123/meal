import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
type Scope = "week" | "day";
function run(args: string[]) {
  const root = process.env.MEAL_PLAN_ROOT?.trim() || process.cwd();
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "mealctl.mjs"), ...args], { cwd: root, encoding: "utf8", env: {...process.env, MEAL_PLAN_ROOT: root}, timeout: 120_000 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "식단 선택기에 실패했습니다.").trim());
  return String(result.stdout);
}
function write(payload: unknown) { const file = path.join(os.tmpdir(), `meal-catalog-${crypto.randomUUID()}.json`); fs.writeFileSync(file, JSON.stringify(payload), "utf8"); return file; }
export async function POST(request: Request) {
  try {
    const body = await request.json() as { scope?: Scope; weekStart?: string; date?: string; slot?: "main" | "side-0" | "side-1"; replaceExisting?: boolean };
    const scope = body.scope;
    const date = String(body.date || "");
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date)
      return NextResponse.json({error:"실제로 존재하는 날짜(YYYY-MM-DD)가 필요합니다."},{status:400});
    if (scope === "day") {
      if (body.slot && !["main", "side-0", "side-1"].includes(body.slot))
        return NextResponse.json({error:"지원하지 않는 메뉴 변경 범위입니다."},{status:400});
      const weekStart = new Date(`${date}T00:00:00Z`);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      const context = JSON.parse(run(["context", "--week", weekStart.toISOString().slice(0, 10)])) as { meals?: { date: string; revision: number }[] };
      const payload = JSON.parse(run(["generate-catalog-day", "--date", date, "--slot", body.slot ?? "all", "--salt", String(Date.now())]));
      payload.expectedRevisions = Object.fromEntries(payload.mealChanges.map((change: { date: string }) =>
        [change.date, context.meals?.find((meal) => meal.date === change.date)?.revision]));
      const file=write(payload);
      let published: { shoppingComplete?: boolean; missing?: string[]; missingByWeek?: Record<string,string[]> };
      try { published = JSON.parse(run(["publish-days", "--input", file])); } finally { fs.rmSync(file,{force:true}); }
      const missing = published.missing ?? Object.values(published.missingByWeek ?? {}).flat();
      return NextResponse.json({ok:true,message:`${date} 식단을 카탈로그 선택기로 다시 골랐습니다.${missing.length ? ` 장보기는 레시피가 없는 메뉴 ${missing.length}개 때문에 아직 미완료입니다: ${missing.join(", ")}` : ""}`});
    }
    if (scope === "week") {
      const basis = new Date(`${date}T00:00:00Z`); basis.setUTCDate(basis.getUTCDate() - basis.getUTCDay());
      const weekStart = basis.toISOString().slice(0,10);
      const current = JSON.parse(run(["context", "--week", weekStart])) as { meals?: unknown[] };
      if (current.meals?.length && current.meals.length !== 7)
        return NextResponse.json({error:"이 주차에 일부 날짜만 저장되어 있습니다. 자동으로 덮어쓰지 않으니 먼저 확인해 주세요."},{status:409});
      if (current.meals?.length && body.replaceExisting !== true)
        return NextResponse.json({error:"기존 주간 식단이 있습니다. 다시 구성하려면 확인 후 요청해 주세요."},{status:409});
      const payload = JSON.parse(run(["generate-catalog-week", "--week", weekStart, "--salt", String(Date.now())]));
      if (current.meals?.length)
        payload.expectedRevisions = Object.fromEntries((current.meals as { date: string; revision: number }[]).map((meal) => [meal.date, meal.revision]));
      const file=write(payload);
      let published: { shoppingComplete?: boolean; missingByWeek?: Record<string,string[]> };
      try { published = JSON.parse(run(current.meals?.length ? ["publish-days","--input",file] : ["publish-new-week","--input",file,"--week",weekStart])); }
      finally { fs.rmSync(file,{force:true}); }
      const missing = Object.values(published.missingByWeek ?? {}).flat();
      return NextResponse.json({ok:true,message:`${weekStart} 주간 식단을 카탈로그 선택기로 구성했습니다.${current.meals?.length && missing.length ? ` 장보기는 레시피가 없는 메뉴 ${missing.length}개 때문에 아직 미완료입니다: ${missing.join(", ")}` : !current.meals?.length ? " 레시피와 장보기는 아직 생성되지 않았습니다." : ""}`});
    }
    return NextResponse.json({error:"지원하지 않는 생성 범위입니다."},{status:400});
  } catch (error) {
    const message = error instanceof Error ? error.message : "식단 생성에 실패했습니다.";
    return NextResponse.json({error:message},{status:/다른 요청으로 변경|점검 설정·보유 재료·가족 일정이 변경/.test(message) ? 409 : 500});
  }
}
