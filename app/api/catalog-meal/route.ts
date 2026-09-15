import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
type Scope = "month" | "week" | "day";
function run(args: string[]) {
  const result = spawnSync(process.execPath, ["scripts/mealctl.mjs", ...args], { cwd: process.cwd(), encoding: "utf8", env: process.env, timeout: 120_000 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "식단 선택기에 실패했습니다.").trim());
  return String(result.stdout);
}
function write(payload: unknown) { const file = path.join(os.tmpdir(), `meal-catalog-${crypto.randomUUID()}.json`); fs.writeFileSync(file, JSON.stringify(payload), "utf8"); return file; }
export async function POST(request: Request) {
  try {
    const body = await request.json() as { scope?: Scope; month?: string; weekStart?: string; date?: string; slot?: "main" | "side-0" | "side-1"; replace?: boolean };
    const scope = body.scope ?? "month";
    if (scope === "month") {
      const month = String(body.month || ""); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("올바른 월이 필요합니다.");
      const file = write(JSON.parse(run(["generate-catalog-month", "--month", month, "--salt", String(Date.now())])));
      try { run(["publish-month", "--input", file, "--month", month, ...(body.replace ? ["--replace", "true"] : [])]); } finally { fs.rmSync(file,{force:true}); }
      return NextResponse.json({ok:true,message:`${month} 월간 식단을 카탈로그 선택기로 구성했습니다.`});
    }
    const date = String(body.date || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("올바른 날짜가 필요합니다.");
    if (scope === "day") {
      const payload = JSON.parse(run(["generate-catalog-day", "--date", date, "--slot", body.slot ?? "all", "--salt", String(Date.now())])); const file=write(payload);
      try { run(payload.mealChanges.length > 1 ? ["publish-days", "--input", file] : ["publish-day","--input",file,"--week",payload.weekStart,"--date",date]); } finally { fs.rmSync(file,{force:true}); }
      return NextResponse.json({ok:true,message:`${date} 식단을 카탈로그 선택기로 다시 골랐습니다.`});
    }
    if (scope === "week") {
      const basis = new Date(`${date}T00:00:00Z`); basis.setUTCDate(basis.getUTCDate() - basis.getUTCDay());
      const changes = Array.from({length:7}, (_, index) => { const value=new Date(basis); value.setUTCDate(value.getUTCDate()+index); const target=value.toISOString().slice(0,10); return JSON.parse(run(["generate-catalog-day","--date",target])).mealChanges[0]; });
      const file=write({schemaVersion:"meal-week.v1",changeReason:"카탈로그 선택기로 주간 식단을 다시 구성했습니다.",mealChanges:changes,recipes:[]});
      try { run(["publish-days","--input",file]); } finally { fs.rmSync(file,{force:true}); }
      return NextResponse.json({ok:true,message:"이번 주 식단을 카탈로그 선택기로 다시 구성했습니다."});
    }
    throw new Error("지원하지 않는 생성 범위입니다.");
  } catch (error) { return NextResponse.json({error:error instanceof Error?error.message:"식단 생성에 실패했습니다."},{status:500}); }
}
