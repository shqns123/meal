import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type GroceryRequest = {
  weekStart?: string;
  id?: string;
  name?: string;
  category?: string;
  purchased?: boolean;
};

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return badJson();
  if (!isSunday(body.weekStart))
    return NextResponse.json(
      { error: "올바른 주차를 선택해 주세요." },
      { status: 400 },
    );
  const name = body.name?.trim();
  if (!name || name.length > 80)
    return NextResponse.json(
      { error: "품목명은 1~80자로 입력해 주세요." },
      { status: 400 },
    );
  const startDate = toDate(body.weekStart!);
  const endDate = toDate(addDays(body.weekStart!, 6));
  const week = await prisma.shoppingWeek.upsert({
    where: { startDate },
    create: { startDate, endDate },
    update: { endDate },
  });
  const item = await prisma.shoppingItem.upsert({
    where: { weekId_name: { weekId: week.id, name } },
    create: {
      weekId: week.id,
      name,
      quantity: 1,
      unit: "개",
      category: body.category?.trim() || "기타",
      usePlan: "직접 추가",
      purchased: false,
    },
    update: { category: body.category?.trim() || "기타" },
  });
  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await readBody(request);
  if (!body) return badJson();
  if (!body.id || typeof body.purchased !== "boolean")
    return NextResponse.json(
      { error: "품목과 완료 여부가 필요합니다." },
      { status: 400 },
    );
  const item = await prisma.shoppingItem
    .update({ where: { id: body.id }, data: { purchased: body.purchased } })
    .catch(() => null);
  return item
    ? NextResponse.json({ item })
    : NextResponse.json(
        { error: "장보기 품목을 찾지 못했습니다." },
        { status: 404 },
      );
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id)
    return NextResponse.json(
      { error: "삭제할 품목이 필요합니다." },
      { status: 400 },
    );
  const item = await prisma.shoppingItem
    .delete({ where: { id } })
    .catch(() => null);
  return item
    ? NextResponse.json({ success: true })
    : NextResponse.json(
        { error: "장보기 품목을 찾지 못했습니다." },
        { status: 404 },
      );
}

async function readBody(request: Request): Promise<GroceryRequest | null> {
  try {
    return (await request.json()) as GroceryRequest;
  } catch {
    return null;
  }
}
function badJson() {
  return NextResponse.json(
    { error: "요청 형식이 올바르지 않습니다." },
    { status: 400 },
  );
}
function isSunday(value?: string): value is string {
  return Boolean(
    value &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).getUTCDay() === 0,
  );
}
function toDate(value: string) {
  return new Date(`${value}T00:00:00+09:00`);
}
function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
