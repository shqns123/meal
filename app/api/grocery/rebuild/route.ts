import { spawnSync } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let weekStart: string;
  try { weekStart = String((await request.json()).weekStart ?? ""); }
  catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? new Date(`${weekStart}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== weekStart || date.getUTCDay() !== 0)
    return NextResponse.json({ error: "올바른 일요일 시작 주차를 선택해 주세요." }, { status: 400 });
  const root = process.env.MEAL_PLAN_ROOT?.trim() || process.cwd();
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "mealctl.mjs"), "rebuild-shopping", "--week", weekStart], {
    cwd: root,
    env: { ...process.env, MEAL_PLAN_ROOT: root },
    encoding: "utf8",
    timeout: 120_000,
  });
  let output: { success?: boolean; missing?: string[]; issues?: Record<string, string>; shoppingItems?: number; reviewItems?: number } | null = null;
  try { output = JSON.parse(result.stdout); } catch {}
  if (result.status !== 0 || !output?.success) {
    const missing = output?.missing ?? [];
    const issueDetails = Object.entries(output?.issues ?? {}).map(([name, reason]) => `${name}: ${reason}`);
    return NextResponse.json({
      error: missing.length
        ? `장보기 계산을 완료하지 않아 기존 목록을 유지했습니다. 확인 필요: ${missing.join(", ")}${issueDetails.length ? ` (${issueDetails.join("; ")})` : ""}`
        : String(result.stderr || result.error?.message || "장보기 계산에 실패했습니다.").trim().slice(0, 1200),
      missing,
      issues: output?.issues ?? {},
    }, { status: missing.length ? 422 : 500 });
  }
  return NextResponse.json({ ...output, message: `이번 주 DB 레시피의 재료 ${output.shoppingItems ?? 0}개 항목을 표시했습니다. 보유 재료도 포함됩니다.${output.reviewItems ? ` 그중 ${output.reviewItems}개는 원문 수량을 직접 확인해 주세요.` : ""}` });
}
