"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

type CatalogMenuWeight = {
  sourceCategory: string;
  baseName: string;
  cookingMethods: string[];
  weightPercent: number;
};

const SOURCE_CATEGORIES = ["메인반찬", "밑반찬", "국/탕", "찌개", "면/만두", "밥/죽/떡"];
const fieldClass = "h-11 rounded-lg border border-black/20 bg-white px-3 text-sm text-[#111111] outline-none focus:ring-2 focus:ring-[#0075de]";
const keyFor = (menu: Pick<CatalogMenuWeight, "sourceCategory" | "baseName">) => `${menu.sourceCategory}|${menu.baseName}`;

export function CatalogWeightSettings() {
  const [menus, setMenus] = useState<CatalogMenuWeight[]>([]);
  const [category, setCategory] = useState("메인반찬");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/catalog-weights");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "가중치를 불러오지 못했습니다.");
      setMenus(data.menus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가중치를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const valueFor = (menu: CatalogMenuWeight) => drafts[keyFor(menu)] ?? menu.weightPercent;
  const visible = useMemo(() => menus.filter(menu => menu.sourceCategory === category
    && (!search.trim() || menu.baseName.includes(search.trim()))), [menus, category, search]);
  const changedCount = Object.keys(drafts).length;

  const edit = (menu: CatalogMenuWeight, value: number) => {
    const next = Math.max(0, Math.min(500, Math.round(value || 0)));
    setMessage("");
    setDrafts(current => {
      const updated = { ...current };
      if (next === menu.weightPercent) delete updated[keyFor(menu)];
      else updated[keyFor(menu)] = next;
      return updated;
    });
  };
  const resetVisible = () => {
    setMessage("");
    setDrafts(current => {
      const updated = { ...current };
      for (const menu of visible) {
        if (menu.weightPercent === 100) delete updated[keyFor(menu)];
        else updated[keyFor(menu)] = 100;
      }
      return updated;
    });
  };
  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const updates = menus.filter(menu => drafts[keyFor(menu)] !== undefined).map(menu => ({
        sourceCategory: menu.sourceCategory,
        baseName: menu.baseName,
        weightPercent: drafts[keyFor(menu)],
      }));
      const response = await fetch("/api/catalog-weights", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "가중치를 저장하지 못했습니다.");
      setDrafts({}); await load(); setMessage(data.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가중치를 저장하지 못했습니다.");
    } finally { setSaving(false); }
  };

  return <section className="space-y-6">
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">선택기 설정</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[#615d59]">기본메뉴가 자동 식단에 얼마나 자주 등장할지 상대 가중치를 직접 조정합니다. 저장한 값은 기존 식단을 바꾸지 않고 다음 생성부터 적용됩니다.</p>
    </div>

    <div className="rounded-xl border border-black/10 bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e6f3fe] text-[#075f9f]"><SlidersHorizontal size={19} aria-hidden="true" /></span>
        <div className="max-w-3xl">
          <h2 className="font-semibold">100%가 지금의 기본값입니다</h2>
          <p className="mt-2 text-sm leading-6 text-[#615d59]">200%는 현재보다 더 자주, 50%는 덜 자주 선택되도록 합니다. 0%는 해당 기본메뉴를 자동 선택에서 제외합니다. 이 숫자는 최종 확률이 아니라 상대 가중치이며, 조리계열 선택·최근 14일 기본메뉴 제외·30일 세부메뉴 제한·보유 재료 보정도 함께 적용됩니다.</p>
          <p className="mt-2 text-xs leading-5 text-black/50">세부메뉴 수는 기본메뉴 가중치를 늘리지 않습니다. 같은 이름이라도 종류가 다르면 별도 기본메뉴로 저장됩니다.</p>
        </div>
      </div>
    </div>

    <div className="rounded-xl border border-black/10 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="종류별 필터">
        {SOURCE_CATEGORIES.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`min-h-10 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075de] ${category === item ? "bg-[#e6f3fe] font-medium text-[#075f9f]" : "text-[#615d59] hover:bg-[#f6f5f4] hover:text-[#111111]"}`}>{item}</button>)}
      </div>
      <div className="mt-5 flex flex-col gap-3 border-t border-black/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/40" size={17} aria-hidden="true" />
          <span className="sr-only">기본메뉴 검색</span>
          <input className={`${fieldClass} w-full pl-10`} value={search} onChange={event => setSearch(event.target.value)} placeholder="기본메뉴 검색" />
        </label>
        <button type="button" disabled={!visible.some(menu => valueFor(menu) !== 100)} onClick={resetVisible} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm text-[#615d59] transition-colors hover:bg-[#f6f5f4] hover:text-[#111111] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075de]"><RotateCcw size={16} aria-hidden="true" />보이는 메뉴를 100%로</button>
      </div>
    </div>

    {error && <div role="alert" className="rounded-lg bg-[#fff1ef] px-4 py-3 text-sm text-[#9d2718]">{error} <button className="ml-2 underline underline-offset-4" onClick={() => void load()}>다시 불러오기</button></div>}
    {message && <p role="status" className="rounded-lg bg-[#eef8f2] px-4 py-3 text-sm text-[#315945]">{message}</p>}
    {loading ? <p role="status" className="py-8 text-sm text-[#615d59]">가중치를 불러오는 중입니다.</p> : visible.length ? <div className="divide-y divide-black/10 rounded-xl border border-black/10 bg-white px-4 sm:px-6">
      {visible.map(menu => {
        const value = valueFor(menu);
        return <article key={keyFor(menu)} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-medium text-[#111111]">{menu.baseName}</h2>
            <p className="mt-1 text-xs text-[#615d59]">{menu.cookingMethods.length ? menu.cookingMethods.join(" · ") : "조리방법 미분류"}{menu.weightPercent !== 100 ? ` · 저장값 ${menu.weightPercent}%` : " · 기본값"}</p>
          </div>
          <label className="flex items-center gap-2 text-sm sm:w-44 sm:justify-end">
            <span className="text-[#615d59]">가중치</span>
            <span className="relative w-24"><input type="number" min={0} max={500} step={10} inputMode="numeric" aria-label={`${menu.baseName} 가중치`} className={`${fieldClass} w-full pr-8 text-right tabular-nums`} value={value} disabled={saving} onChange={event => edit(menu, Number(event.target.value))} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-black/45">%</span></span>
          </label>
        </article>;
      })}
    </div> : <p className="rounded-xl border border-dashed border-black/15 bg-white px-4 py-8 text-center text-sm text-[#615d59]">검색 조건에 맞는 기본메뉴가 없습니다.</p>}

    <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/15 bg-white p-4">
      <p className="text-sm text-[#615d59]">{changedCount ? `${changedCount}개 변경 · 저장 전까지 선택기에 반영되지 않습니다.` : "저장된 값이 다음 자동 생성에 적용됩니다."}</p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={!changedCount || saving} onClick={() => setDrafts({})}>변경 취소</Button>
        <Button disabled={!changedCount || saving || loading} onClick={() => void save()}>{saving ? "저장 중…" : "가중치 저장"}</Button>
      </div>
    </div>
  </section>;
}
