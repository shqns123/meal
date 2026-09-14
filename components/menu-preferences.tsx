"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CATEGORIES, effectiveUsage } from "@/lib/dish-preference-rules.mjs";

type Preference = {scope: string; usage: string; familiarity: string; note: string; confirmedAt?: string};
type Dish = {name: string; category: string; preferences: Preference[]};
type Patch = {name: string; category: string; scope: string; usage?: string; familiarity?: string; note?: string};
const keyFor = (dish: {name: string; category: string}) => `${dish.category}|${dish.name}`;
const fieldClass = "min-h-11 w-full rounded-lg border border-black/20 bg-white px-3 text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#0075de]";
const usageLabels: Record<string, string> = {UNKNOWN: "아직 미확인", ALLOW: "넣어도 좋아요", AVOID: "피해주세요"};
const scopeLabels: Record<string, string> = {family: "가족 전체", father: "아빠", mother: "엄마", child: "아기"};

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
  const [category, setCategory] = useState("전체");
  const [filter, setFilter] = useState("ALL");
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
      const data = await response.json(); setDishes(data.dishes); setFamily(data.family);
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
  const visible = dishes.filter(dish => dish.name.includes(search.trim()) && (category === "전체" || dish.category === category) && (filter === "ALL" || preference(dish).usage === filter));
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
    setSearch(name); setCategory("전체"); setFilter("ALL"); setNewName("");
    setMessage("후보를 추가했습니다. 식단 사용 여부나 익숙함을 선택한 뒤 저장해 주세요.");
  };
  return <section className="space-y-6">
    <div><h1 className="text-3xl font-semibold tracking-tight">우리 집 메뉴</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#615d59]">식단에 넣어도 되는 음식을 알려주세요. 기존 식단과 레시피는 후보로만 가져왔어요. 선택하지 않은 메뉴는 미확인으로 남습니다.</p></div>
    <div className="rounded-xl border border-black/10 bg-white p-4 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-2 text-sm">적용 대상<select className={fieldClass} value={scope} disabled={saving} onChange={e => setScope(e.target.value)}><option value="family">가족 전체</option>{family.map(member => <option key={member.role} value={member.role}>{member.name} · {scopeLabels[member.role]}</option>)}</select></label>
        <label className="space-y-2 text-sm">메뉴 검색<input className={fieldClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="예: 두부조림" /></label>
        <label className="space-y-2 text-sm">메뉴 구분<select className={fieldClass} value={category} onChange={e => setCategory(e.target.value)}>{["전체", ...CATEGORIES].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="space-y-2 text-sm">식단 사용<select className={fieldClass} value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">전체 보기</option>{Object.entries(usageLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <p className="mt-4 text-sm leading-6 text-[#615d59]">가족 전체의 허용을 기본으로 적용하되, 함께 먹는 구성원이 피하는 메뉴는 제외합니다. 익숙함만 표시하면 자동 식단 사용이 허용되지는 않아요.</p>
    </div>
    <details className="rounded-xl border border-black/10 bg-white p-4"><summary className="cursor-pointer text-sm font-medium">목록에 없는 메뉴 추가</summary><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input aria-label="추가할 메뉴명" className={fieldClass} value={newName} maxLength={100} onChange={e => setNewName(e.target.value)} placeholder="메뉴명" /><select aria-label="추가할 메뉴 구분" className={fieldClass} value={newCategory} onChange={e => setNewCategory(e.target.value)}>{CATEGORIES.map(value => <option key={value}>{value}</option>)}</select><Button variant="outline" disabled={!newName.trim() || saving || loading} onClick={add}>후보 추가</Button></div></details>
    {error && <div role="alert" className="text-sm text-[#b42318]">{error}<button className="ml-3 underline" onClick={() => void load()}>다시 불러오기</button></div>}
    {message && <p role="status" className="text-sm text-[#315945]">{message}</p>}
    {loading ? <p role="status">메뉴를 불러오는 중입니다.</p> : <MenuCandidateReview dishes={visible} saving={saving} preference={preference} edit={edit} />}
    <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/15 bg-white p-4">
      <p className="text-sm text-[#615d59]">{Object.keys(drafts).length ? `${Object.keys(drafts).length}개 변경 · 저장 후 이후 식단부터 반영` : "기존 식단은 그대로 유지됩니다."}</p>
      <Button disabled={saving || loading || !Object.keys(drafts).length} onClick={() => void save()}>{saving ? "저장 중…" : "선택한 취향 저장"}</Button>
    </div>
  </section>;
}

function MenuCandidateReview({dishes, saving, preference, edit}: {dishes: Dish[]; saving: boolean; preference: (dish: Dish) => {usage: string; familiarity: string; note: string}; edit: (dish: Dish, patch: Partial<Patch>) => void}) {
  if (!dishes.length) return <p className="py-8 text-sm text-[#615d59]">조건에 맞는 메뉴가 없습니다. 검색 조건을 바꾸거나 메뉴를 추가해 주세요.</p>;
  return <div className="divide-y divide-black/10 rounded-xl border border-black/10 bg-white px-4 sm:px-6">{dishes.map(dish => {
    const value = preference(dish);
    return <article key={keyFor(dish)} className="py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-medium">{dish.name}</h2><p className="mt-1 text-xs text-[#615d59]">{dish.category}</p></div>
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
  useEffect(() => { let live = true; fetch("/api/dish-preferences").then(r => r.ok ? r.json() : null).then(data => { if (live && data) { const dish = data.dishes.find((d: Dish) => d.name === name && d.category === category); setUsage(dish ? effectiveUsage(dish.preferences) : "UNKNOWN"); } }).catch(() => {}); return () => {live = false;}; }, [name,category]);
  const save = async (next: string) => {
    setBusy(true); setStatus("");
    try { await savePreferences([{name,category,scope: "family",usage: next}], "day-detail"); setUsage(next); setStatus("가족 전체 취향을 저장했어요. 기존 식단은 유지됩니다."); }
    catch(e) { setStatus(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally {setBusy(false);}
  };
  return <div className="mt-3 border-t border-black/10 pt-3"><div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-sm">{name} <span className="text-xs text-[#615d59]">{usageLabels[usage]}</span></span><button type="button" disabled={busy} aria-pressed={usage === "ALLOW"} onClick={() => void save("ALLOW")} className="min-h-11 rounded-lg border border-black/20 bg-white px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#0075de] disabled:opacity-50">다음에도 넣어줘</button><button type="button" disabled={busy} aria-pressed={usage === "AVOID"} onClick={() => void save("AVOID")} className="min-h-11 rounded-lg border border-black/20 bg-white px-3 text-xs focus-visible:ring-2 focus-visible:ring-[#0075de] disabled:opacity-50">앞으로 빼줘</button></div>{status && <p role="status" className="mt-2 text-xs text-[#615d59]">{status}</p>}</div>;
}
