"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CATEGORIES, effectiveUsage } from "@/lib/dish-preference-rules.mjs";

type Preference = {scope: string; usage: string; familiarity: string; note: string; confirmedAt?: string};
type CatalogMatch = {sourceCategory: string; baseMenu: string; isBaseMenu: boolean; cookingMethods: string[]; ingredientCategories: string[]};
type Dish = {name: string; category: string; preferences: Preference[]; catalogMatches?: CatalogMatch[]};
type Patch = {name: string; category: string; scope: string; usage?: string; familiarity?: string; note?: string};
const keyFor = (dish: {name: string; category: string}) => `${dish.category}|${dish.name}`;
const fieldClass = "min-h-11 w-full rounded-lg border border-black/20 bg-white px-3 text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#0075de]";
const usageLabels: Record<string, string> = {UNKNOWN: "아직 미확인", ALLOW: "넣어도 좋아요", AVOID: "피해주세요"};
const scopeLabels: Record<string, string> = {family: "가족 전체", father: "아빠", mother: "엄마", child: "아기"};
const SOURCE_CATEGORIES = ["밑반찬", "메인반찬", "국/탕", "찌개", "면/만두", "밥/죽/떡"];
const METHODS = ["볶음", "끓이기", "부침", "조림", "무침", "비빔", "찜", "절임", "튀김", "삶기", "굽기", "데치기", "회", "기타"];
const INGREDIENTS = ["소고기", "돼지고기", "닭고기", "육류", "채소류", "해물류", "달걀/유제품", "가공식품류", "쌀", "밀가루", "건어물류", "버섯류", "과일류", "콩/견과류", "곡류", "기타"];
const PAGE_SIZE = 60;

async function savePreferences(updates: Patch[], source = "menu-settings") {
  const response = await fetch("/api/dish-preferences", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({updates, source})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "저장하지 못했습니다. 다시 시도해 주세요.");
  return data.message as string;
}

export function MenuPreferences() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [family, setFamily] = useState<{name: string; role: string}[]>([]);
  const [scope, setScope] = useState("family");
  const [search, setSearch] = useState("");
  const [sourceCategory, setSourceCategory] = useState("전체");
  const [method, setMethod] = useState("전체");
  const [ingredient, setIngredient] = useState("전체");
  const [baseMenu, setBaseMenu] = useState("전체");
  const [filter, setFilter] = useState("ALL");
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const [catalogAvailable, setCatalogAvailable] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Patch>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("주찬");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/dish-preferences");
      if (!response.ok) throw new Error("메뉴를 불러오지 못했습니다. 다시 시도해 주세요.");
      const data = await response.json(); setDishes(data.dishes); setFamily(data.family); setCatalogAvailable(data.catalogAvailable !== false);
    } catch (e) { setError(e instanceof Error ? e.message : "메뉴를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const draftKey = (dish: Dish) => `${scope}|${keyFor(dish)}`;
  const preference = (dish: Dish) => ({usage: "UNKNOWN", familiarity: "UNKNOWN", note: "", ...dish.preferences.find(p => p.scope === scope), ...drafts[draftKey(dish)]});
  const edit = (dish: Dish, patch: Partial<Patch>) => {
    setMessage("");
    setDrafts(current => ({...current, [draftKey(dish)]: {...current[draftKey(dish)], ...patch, name: dish.name, category: dish.category, scope}}));
  };
  const catalogMatch = useCallback((dish: Dish) => (dish.catalogMatches ?? []).find(match =>
    (sourceCategory === "전체" || match.sourceCategory === sourceCategory) &&
    (method === "전체" || match.cookingMethods.includes(method)) &&
    (ingredient === "전체" || match.ingredientCategories.includes(ingredient)) &&
    (baseMenu === "전체" || match.baseMenu === baseMenu),
  ), [sourceCategory, method, ingredient, baseMenu]);
  const baseMenus = useMemo(() => [...new Set(dishes.flatMap(dish => (dish.catalogMatches ?? [])
    .filter(match => (sourceCategory === "전체" || match.sourceCategory === sourceCategory)
      && (method === "전체" || match.cookingMethods.includes(method))
      && (ingredient === "전체" || match.ingredientCategories.includes(ingredient)))
    .map(match => match.baseMenu)))].sort((a, b) => a.localeCompare(b, "ko")), [dishes, sourceCategory, method, ingredient]);
  const visible = dishes.filter(dish => {
    const matches = (dish.catalogMatches ?? []).filter(match =>
      (sourceCategory === "전체" || match.sourceCategory === sourceCategory) &&
      (method === "전체" || match.cookingMethods.includes(method)) &&
      (ingredient === "전체" || match.ingredientCategories.includes(ingredient)) &&
      (baseMenu === "전체" || match.baseMenu === baseMenu));
    const query = search.trim();
    return (!query || dish.name.includes(query) || matches.some(item => item.baseMenu.includes(query)))
      && (sourceCategory === "전체" && method === "전체" && ingredient === "전체" && baseMenu === "전체" || matches.length > 0)
      && (filter === "ALL" || preference(dish).usage === filter);
  });
  const hasActiveFilter = Boolean(search.trim()) || sourceCategory !== "전체" || method !== "전체" || ingredient !== "전체" || baseMenu !== "전체" || filter !== "ALL";
  useEffect(() => { setDisplayLimit(PAGE_SIZE); }, [search, sourceCategory, method, ingredient, baseMenu, filter]);
  const save = async () => {
    setSaving(true); setError("");
    try { const notice = await savePreferences(Object.values(drafts)); setDrafts({}); await load(); setMessage(notice); }
    catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const add = () => {
    const name = newName.trim().replace(/\s+/g, " "); if (!name) return;
    const dish = {name, category: newCategory, preferences: []};
    setDishes(current => current.some(item => keyFor(item) === keyFor(dish)) ? current : [dish, ...current]);
    setSearch(name); setSourceCategory("전체"); setMethod("전체"); setIngredient("전체"); setBaseMenu("전체"); setFilter("ALL"); setNewName("");
    setMessage("후보를 추가했습니다. 식단 사용 여부나 익숙함을 선택한 뒤 저장해 주세요.");
  };
  return <section className="space-y-6">
    <div><h1 className="text-3xl font-semibold tracking-tight">우리 집 메뉴</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#615d59]">피하고 싶은 메뉴를 표시해 주세요. 미확인 메뉴도 식단 후보로 사용할 수 있고, 선택하지 않은 메뉴의 취향은 미확인으로 남습니다.</p></div>
    <div className="rounded-xl border border-black/10 bg-white p-4 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-2 text-sm">적용 대상<select className={fieldClass} value={scope} disabled={saving} onChange={e => setScope(e.target.value)}><option value="family">가족 전체</option>{family.map(member => <option key={member.role} value={member.role}>{member.name} · {scopeLabels[member.role]}</option>)}</select></label>
        <label className="space-y-2 text-sm">메뉴 검색<input className={fieldClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="예: 두부조림" /></label>
        <label className="space-y-2 text-sm">식단 사용<select className={fieldClass} value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">전체 보기</option>{Object.entries(usageLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="mt-6 space-y-4 border-t border-black/10 pt-5">
        <CatalogFilterRow label="종류별" options={SOURCE_CATEGORIES} value={sourceCategory} onChange={value => { setSourceCategory(value); setBaseMenu("전체"); }} />
        <CatalogFilterRow label="방법별" options={METHODS} value={method} onChange={value => { setMethod(value); setBaseMenu("전체"); }} />
        <CatalogFilterRow label="재료별" options={INGREDIENTS} value={ingredient} onChange={value => { setIngredient(value); setBaseMenu("전체"); }} />
      </div>
      <div className="mt-5 flex flex-col gap-3 border-t border-black/10 pt-4 sm:flex-row sm:items-end sm:justify-between">
        <label className="w-full space-y-2 text-sm sm:max-w-xs">기본메뉴 좁히기<select className={fieldClass} value={baseMenu} onChange={e => setBaseMenu(e.target.value)}><option value="전체">전체 기본메뉴</option>{baseMenus.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="button" className="min-h-11 rounded-lg px-3 text-sm text-[#615d59] underline underline-offset-4 hover:text-[#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075de]" onClick={() => { setSearch(""); setSourceCategory("전체"); setMethod("전체"); setIngredient("전체"); setBaseMenu("전체"); setFilter("ALL"); }}>필터 초기화</button>
      </div>
      <p className="mt-4 text-sm leading-6 text-[#615d59]">방법·재료 필터는 만개의레시피 카탈로그의 기본메뉴 태그를 기준으로 합니다. 세부메뉴의 실제 레시피 재료와 다를 수 있어요. 함께 먹는 구성원의 기피는 식단 생성에서 제외하며, 여기서 취향을 자동 추정하지 않습니다.</p>
      {!catalogAvailable && <p role="status" className="mt-3 text-sm text-[#b42318]">카탈로그를 읽지 못해 종류·방법·재료 필터의 메뉴를 표시할 수 없습니다. 저장된 우리 집 메뉴는 검색과 식단 사용 필터로 볼 수 있습니다.</p>}
    </div>
    <details className="rounded-xl border border-black/10 bg-white p-4"><summary className="cursor-pointer text-sm font-medium">목록에 없는 메뉴 추가</summary><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input aria-label="추가할 메뉴명" className={fieldClass} value={newName} maxLength={100} onChange={e => setNewName(e.target.value)} placeholder="메뉴명" /><select aria-label="추가할 메뉴 구분" className={fieldClass} value={newCategory} onChange={e => setNewCategory(e.target.value)}>{CATEGORIES.map(value => <option key={value}>{value}</option>)}</select><Button variant="outline" disabled={!newName.trim() || saving || loading} onClick={add}>후보 추가</Button></div></details>
    {error && <div role="alert" className="text-sm text-[#b42318]">{error}<button className="ml-3 underline" onClick={() => void load()}>다시 불러오기</button></div>}
    {message && <p role="status" className="text-sm text-[#315945]">{message}</p>}
    {loading ? <p role="status">메뉴를 불러오는 중입니다.</p> : hasActiveFilter ? <div className="space-y-4"><p role="status" className="text-sm text-[#615d59]">조건에 맞는 메뉴 {visible.length.toLocaleString("ko-KR")}개{visible.length > displayLimit ? ` · ${displayLimit}개 표시 중` : ""}</p><MenuCandidateReview dishes={visible.slice(0, displayLimit)} saving={saving} preference={preference} edit={edit} catalogMatch={catalogMatch} />{visible.length > displayLimit && <div className="text-center"><Button variant="outline" onClick={() => setDisplayLimit(current => current + PAGE_SIZE)}>메뉴 더 보기</Button></div>}</div> : <p className="rounded-xl border border-dashed border-black/15 bg-white px-4 py-8 text-center text-sm text-[#615d59]">종류·방법·재료를 선택하거나 메뉴명을 검색하면 해당 메뉴가 표시됩니다.</p>}
    <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/15 bg-white p-4">
      <p className="text-sm text-[#615d59]">{Object.keys(drafts).length ? `${Object.keys(drafts).length}개 변경 · 저장 후 이후 식단부터 반영` : "기존 식단은 그대로 유지됩니다."}</p>
      <Button disabled={saving || loading || !Object.keys(drafts).length} onClick={() => void save()}>{saving ? "저장 중…" : "선택한 취향 저장"}</Button>
    </div>
  </section>;
}

function CatalogFilterRow({label, options, value, onChange}: {label: string; options: string[]; value: string; onChange: (value: string) => void}) {
  return <div className="grid gap-2 sm:grid-cols-[4rem_1fr] sm:items-start"><span className="pt-2 text-sm font-medium text-[#615d59]">{label}</span><div className="flex flex-wrap gap-1.5" role="group" aria-label={`${label} 필터`}>{["전체", ...options].map(option => <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)} className={`min-h-9 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075de] ${value === option ? "bg-[#e6f3fe] font-medium text-[#075f9f]" : "text-[#615d59] hover:bg-[#f6f5f4] hover:text-[#111111]"}`}>{option}</button>)}</div></div>;
}

function MenuCandidateReview({dishes, saving, preference, edit, catalogMatch}: {dishes: Dish[]; saving: boolean; preference: (dish: Dish) => {usage: string; familiarity: string; note: string}; edit: (dish: Dish, patch: Partial<Patch>) => void; catalogMatch: (dish: Dish) => CatalogMatch | undefined}) {
  if (!dishes.length) return <p className="py-8 text-sm text-[#615d59]">조건에 맞는 메뉴가 없습니다. 검색 조건을 바꾸거나 메뉴를 추가해 주세요.</p>;
  return <div className="divide-y divide-black/10 rounded-xl border border-black/10 bg-white px-4 sm:px-6">{dishes.map(dish => {
    const value = preference(dish);
    const catalog = catalogMatch(dish);
    return <article key={keyFor(dish)} className="py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-medium">{dish.name}</h2><p className="mt-1 text-xs text-[#615d59]">{catalog ? `${catalog.sourceCategory} · ${catalog.isBaseMenu ? "기본메뉴" : `기본메뉴 ${catalog.baseMenu}의 세부메뉴`}` : dish.category}</p></div>
        <label className="w-full space-y-1 text-xs sm:w-48">식단 사용<select aria-label={`${dish.name} 식단 사용`} className={fieldClass} value={value.usage} disabled={saving} onChange={e => edit(dish, {usage: e.target.value})}>{Object.entries(usageLabels).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      </div>
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-[#615d59]">익숙함과 메모{value.familiarity !== "UNKNOWN" ? ` · ${value.familiarity === "FAMILIAR" ? "먹어봤어요" : "생소해요"}` : ""}{value.note ? " · 메모 있음" : ""}</summary><div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]"><select aria-label={`${dish.name} 익숙함`} className={fieldClass} value={value.familiarity} disabled={saving} onChange={e => edit(dish, {familiarity: e.target.value})}><option value="UNKNOWN">익숙함 미확인</option><option value="FAMILIAR">먹어봤어요</option><option value="UNFAMILIAR">생소해요</option></select><input aria-label={`${dish.name} 메모`} className={fieldClass} value={value.note} maxLength={500} disabled={saving} onChange={e => edit(dish, {note: e.target.value})} placeholder="예: 아기도 잘 먹어요" /></div></details>
    </article>;
  })}</div>;
}

export function MenuFeedback({name, category}: {name: string; category: string}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState("UNKNOWN");
  useEffect(() => { let live = true; fetch(`/api/dish-preferences?name=${encodeURIComponent(name)}&category=${encodeURIComponent(category)}`).then(r => r.ok ? r.json() : null).then(data => { if (live && data) { const dish = data.dishes.find((d: Dish) => d.name === name && d.category === category); setUsage(dish ? effectiveUsage(dish.preferences) : "UNKNOWN"); } }).catch(() => {}); return () => {live = false;}; }, [name,category]);
  const save = async (next: string) => {
    setBusy(true); setStatus("");
    try { await savePreferences([{name,category,scope: "family",usage: next}], "day-detail"); setUsage(next); setStatus("가족 전체 취향을 저장했어요. 기존 식단은 유지됩니다."); }
    catch(e) { setStatus(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally {setBusy(false);}
  };
  return <div className="mt-3 border-t border-black/10 pt-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm">{category} · {name}</span><div className="grid grid-cols-3 gap-2" role="group" aria-label={`${name} 식단 사용`}><button type="button" disabled={busy} aria-pressed={usage === "UNKNOWN"} onClick={() => void save("UNKNOWN")} className={`min-h-11 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075de] disabled:opacity-50 ${usage === "UNKNOWN" ? "border-[#0075de] bg-[#e6f3fe] text-[#075f9f]" : "border-black/20 bg-white hover:bg-black/[.03]"}`}>미확인</button><button type="button" disabled={busy} aria-pressed={usage === "ALLOW"} onClick={() => void save("ALLOW")} className={`min-h-11 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075de] disabled:opacity-50 ${usage === "ALLOW" ? "border-[#32835b] bg-[#e2f3e9] text-[#315945]" : "border-black/20 bg-white hover:bg-black/[.03]"}`}>넣어도 좋아요</button><button type="button" disabled={busy} aria-pressed={usage === "AVOID"} onClick={() => void save("AVOID")} className={`min-h-11 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075de] disabled:opacity-50 ${usage === "AVOID" ? "border-[#c14832] bg-[#ffe0db] text-[#9d2718]" : "border-black/20 bg-white hover:bg-black/[.03]"}`}>피해주세요</button></div></div>{status && <p role="status" className="mt-2 text-xs text-[#615d59]">{status}</p>}</div>;
}
