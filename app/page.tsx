"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Bot,
  CalendarDays,
  Check,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShoppingBasket,
  Sparkles,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";

type Meal = {
  date: string;
  day: number;
  main: string;
  sides: string[];
  type: string;
  color: string;
};
type Recipe = {
  id: number | string;
  color: string;
  title: string;
  meta: string;
  category: "주찬" | "부찬";
  plannedDates: string[];
  tags: string[];
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceAuthor?: string | null;
  description?: string | null;
  prepMinutes?: number;
  cookMinutes?: number;
  instructions?: string[];
  ingredients?: { name: string; amount: string; category: string }[];
  babySplitStep?: string | null;
  storageMethod?: string | null;
  consumeWithin?: string | null;
};
type Grocery = {
  id: number | string;
  name: string;
  category: string;
  done: boolean;
};
type AgentRequest = {
  prompt: string;
  action:
    | "PUBLISH_WEEK"
    | "PUBLISH_MONTH"
    | "UPDATE_DAY"
    | "REVIEW_WEEK"
    | "REGENERATE_RECIPES"
    | "REGENERATE_GROCERY";
  date?: string;
  weekStart?: string;
  targetMonth?: string;
};
type MealSnapshot = {
  date: string;
  lunch?: string | null;
  main: string;
  sides: string[];
  baby?: string | null;
  note?: string | null;
  changeReason?: string | null;
};
type DayUpdateResult = {
  changed: boolean;
  before: MealSnapshot | null;
  after: MealSnapshot | null;
};
type Attendance = { lunchNotAtHome: boolean; dinnerNotAtHome: boolean };
type DayDetail = {
  date: string;
  meal: {
    lunch?: string | null;
    main?: string | null;
    sides: string[];
    baby?: string | null;
    note?: string | null;
    dinnerDiningOut: boolean;
  } | null;
  attendance: { father: Attendance; mother: Attendance };
};
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: { title?: string; url: string }[];
};
type WeeklyReviewRequest = {
  weekStart: string;
  referenceDate: string;
  prompt: string;
};
type PendingAgentJob = {
  requestId: string;
  action: AgentRequest["action"];
  date?: string;
};
type PendingAgentChat = { id: string };
const nav = [
  [CalendarDays, "이 달의 식단"],
  [BookOpen, "레시피"],
  [ShoppingBasket, "장보기"],
] as const;
const seedMeals: Meal[] = [];
const seedRecipes: Recipe[] = [];
const seedGrocery: Grocery[] = [];

export default function Home() {
  const [view, setView] = useState<"month" | "week">("month");
  const [active, setActive] = useState<(typeof nav)[number][1] | "주간 점검">(
    "이 달의 식단",
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [agentRequest, setAgentRequest] = useState<AgentRequest | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [mealItems, setMealItems] = useState(seedMeals);
  const [recipes, setRecipes] = useState(seedRecipes);
  const [grocery, setGrocery] = useState(seedGrocery);
  const [selectedMonth, setSelectedMonth] = useState(() =>
    currentKstDate().slice(0, 7),
  );
  const [selectedWeek, setSelectedWeek] = useState(() =>
    sundayFor(currentKstDate()),
  );
  const [todayScrollRequest, setTodayScrollRequest] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [pendingJobs, setPendingJobs] = useState<PendingAgentJob[]>([]);
  const [pendingChats, setPendingChats] = useState<PendingAgentChat[]>([]);
  const [appNotice, setAppNotice] = useState<string | null>(null);
  const pendingJobsLoaded = useRef(false);
  const pendingChatsLoaded = useRef(false);
  const currentWeek = sundayFor(currentKstDate());
  const dataWeek =
    active === "레시피" || (active === "이 달의 식단" && view === "week")
      ? currentWeek
      : selectedWeek;

  useEffect(() => {
    const load = () =>
      fetch(`/api/meal-data?month=${selectedMonth}&week=${dataWeek}`)
        .then((response) =>
          response.ok
            ? response.json()
            : Promise.reject(new Error("식단을 불러오지 못했습니다.")),
        )
        .then((data) => {
          setMealItems(data.meals ?? []);
          setRecipes(data.recipes ?? []);
          setGrocery(data.grocery ?? []);
        })
        .catch(() => {
          setMealItems([]);
          setRecipes([]);
          setGrocery([]);
        });
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [dataWeek, selectedMonth, refreshVersion]);

  useEffect(() => {
    if (window.isSecureContext && "serviceWorker" in navigator)
      void navigator.serviceWorker.register("/push-worker.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("meal-pending-ai-jobs") ?? "[]");
      if (Array.isArray(saved)) setPendingJobs(saved.filter((item): item is PendingAgentJob => item && typeof item.requestId === "string" && typeof item.action === "string"));
    } catch {
      localStorage.removeItem("meal-pending-ai-jobs");
    } finally {
      pendingJobsLoaded.current = true;
    }
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("meal-pending-ai-chats") ?? "[]");
      if (Array.isArray(saved)) setPendingChats(saved.filter((item): item is PendingAgentChat => item && typeof item.id === "string"));
    } catch {
      localStorage.removeItem("meal-pending-ai-chats");
    } finally {
      pendingChatsLoaded.current = true;
    }
  }, []);
  useEffect(() => {
    if (pendingJobsLoaded.current) localStorage.setItem("meal-pending-ai-jobs", JSON.stringify(pendingJobs));
  }, [pendingJobs]);
  useEffect(() => {
    if (pendingChatsLoaded.current) localStorage.setItem("meal-pending-ai-chats", JSON.stringify(pendingChats));
  }, [pendingChats]);
  useEffect(() => {
    if (!appNotice) return;
    const timeout = window.setTimeout(() => setAppNotice(null), 7_000);
    return () => window.clearTimeout(timeout);
  }, [appNotice]);

  const queueAgentJob = useCallback((job: PendingAgentJob) => {
    setPendingJobs((current) => current.some((item) => item.requestId === job.requestId) ? current : [...current, job]);
  }, []);
  const finishAgentJob = useCallback((requestId: string, message: string) => {
    setPendingJobs((current) => current.filter((item) => item.requestId !== requestId));
    setRefreshVersion((version) => version + 1);
    setAppNotice(message);
  }, []);
  const queueAgentChat = useCallback((chat: PendingAgentChat) => {
    setPendingChats((current) => current.some((item) => item.id === chat.id) ? current : [...current, chat]);
  }, []);
  const finishAgentChat = useCallback((id: string, message: string) => {
    setPendingChats((current) => current.filter((item) => item.id !== id));
    setRefreshVersion((version) => version + 1);
    setAppNotice(message);
  }, []);

  const openDay = (date: string) => {
    setSelectedWeek(sundayFor(date));
    setSelectedDate(date);
  };
  const goToToday = () => {
    const today = currentKstDate();
    setView("month");
    setSelectedMonth(today.slice(0, 7));
    setSelectedWeek(sundayFor(today));
    setTodayScrollRequest((request) => request + 1);
  };
  const editDay = (date: string) => {
    const weekStart = sundayFor(date);
    setSelectedDate(null);
    setSelectedWeek(weekStart);
    setAgentRequest({
      action: "UPDATE_DAY",
      date,
      weekStart,
      prompt: `${date} 식단만 날짜 상세의 식사 여부와 보유 재료에 맞게 검토해줘. 변경이 필요하면 그 날짜의 주찬·부찬(주말이면 점심 포함) 레시피와 장보기만 검증 후 반영하고, 다른 날짜는 건드리지 마.`,
    });
  };
  const changeMonth = (amount: number) => {
    const next = shiftMonth(selectedMonth, amount);
    setSelectedMonth(next);
    setSelectedWeek(sundayFor(`${next}-01`));
  };
  const changeWeek = (amount: number) => {
    const next = addDaysLocal(selectedWeek, amount * 7);
    setSelectedWeek(next);
    setSelectedMonth(addDaysLocal(next, 3).slice(0, 7));
  };

  return (
    <main className="min-h-screen lg:flex">
      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b border-black/[.08] bg-[#f6f5f4]/95 px-5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#ffb110] text-[#5f4300]">
            <UtensilsCrossed size={17} />
          </div>
          <span className="text-sm font-semibold">우리집 식탁</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="grid h-11 w-11 place-items-center rounded-lg text-black/65 transition-transform duration-200 hover:bg-black/[.05] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0075de]/40"
          aria-label="메뉴 열기"
        >
          <Menu size={22} />
        </button>
      </header>
      <button
        type="button"
        className={`mobile-sidebar-backdrop fixed inset-0 z-30 block bg-black/25 lg:hidden ${mobileNavOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setMobileNavOpen(false)}
        aria-label="메뉴 닫기"
      />
      <aside
        data-mobile-open={mobileNavOpen}
        className={`app-sidebar fixed inset-y-0 z-40 w-[252px] border-r border-black/[.08] bg-white px-4 py-5 shadow-xl lg:translate-x-0 lg:shadow-none ${sidebarCollapsed ? "lg:w-[72px] lg:px-3" : "lg:w-[252px] lg:px-4"}`}
      >
        <div
          className={`mb-9 flex ${sidebarCollapsed ? "flex-col items-center gap-2" : "items-center justify-between px-2"}`}
        >
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#ffb110] text-[#5f4300]">
              <UtensilsCrossed size={19} />
            </div>
            {!sidebarCollapsed && (
              <div>
                <p className="text-[15px] font-semibold">우리집 식탁</p>
                <p className="text-xs text-black/55">우리 세 식구</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="grid h-11 w-11 place-items-center rounded-lg text-black/45 hover:bg-black/[.05] lg:hidden"
            aria-label="메뉴 닫기"
          >
            <X size={20} />
          </button>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-black/45 transition-colors hover:bg-black/[.05] hover:text-black focus:outline-none focus:ring-2 focus:ring-[#0075de]/40 lg:grid"
            aria-label={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
          >
            {sidebarCollapsed ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronLeft size={16} />
            )}
          </button>
        </div>
        <div className="space-y-1">
          {nav.map(([Icon, label]) => (
            <button
              key={label}
              onClick={() => {
                setActive(label);
                setMobileNavOpen(false);
              }}
              title={sidebarCollapsed ? label : undefined}
              className={`sidebar-link ${active === label ? "active" : ""} ${sidebarCollapsed ? "justify-center px-0" : ""}`}
            >
              <Icon size={18} />
              {!sidebarCollapsed && label}
            </button>
          ))}
        </div>
        <div
          className={`absolute bottom-5 ${sidebarCollapsed ? "left-3 right-3" : "left-4 right-4"}`}
        >
          <button
            type="button"
            onClick={() => {
              setActive("주간 점검");
              setMobileNavOpen(false);
            }}
            title={sidebarCollapsed ? "주간 점검 설정" : undefined}
            className={`mb-2 flex h-11 w-full items-center rounded-xl border border-black/[.08] bg-white text-black/60 transition-colors hover:bg-[#f6f5f4] hover:text-black focus:outline-none focus:ring-2 focus:ring-[#0075de]/40 ${sidebarCollapsed ? "justify-center" : "gap-2 px-3"}`}
          >
            <Settings size={18} />
            {!sidebarCollapsed && (
              <span className="text-sm font-medium">주간 점검 설정</span>
            )}
          </button>
          <div
            className={`flex items-center rounded-xl bg-[#f6f5f4] p-3 ${sidebarCollapsed ? "justify-center" : "gap-2"}`}
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#0975de] text-xs text-white">
              우
            </span>
            {!sidebarCollapsed && (
              <span className="text-sm font-medium">우진 님</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              void fetch("/api/auth/logout", { method: "POST" }).finally(() =>
                window.location.assign("/login"),
              );
            }}
            title={sidebarCollapsed ? "로그아웃" : undefined}
            className={`mt-2 flex h-10 w-full items-center rounded-xl text-black/50 transition-colors hover:bg-[#f6f5f4] hover:text-black focus:outline-none focus:ring-2 focus:ring-[#0075de]/40 ${sidebarCollapsed ? "justify-center" : "gap-2 px-3"}`}
          >
            <LogOut size={17} />
            {!sidebarCollapsed && <span className="text-sm font-medium">로그아웃</span>}
          </button>
        </div>
      </aside>
      <section
        className={`min-w-0 flex-1 pt-16 transition-[margin] duration-200 lg:pt-0 ${sidebarCollapsed ? "lg:ml-[72px]" : "lg:ml-[252px]"}`}
      >
        <div className="mx-auto max-w-[1440px] p-5 md:p-9">
          {active === "이 달의 식단" && (
            <MealPlanner
              view={view}
              setView={setView}
              month={selectedMonth}
              weekStart={currentWeek}
              onChangeMonth={changeMonth}
              onGoToday={goToToday}
              todayScrollRequest={todayScrollRequest}
              onGenerateMonth={() =>
                setAgentRequest({
                  action: "PUBLISH_MONTH",
                  targetMonth: selectedMonth,
                  prompt: `${formatMonth(selectedMonth)}의 월간 식단을 생성하고 검증 후 저장해줘. 레시피와 장보기는 생성하지 마.`,
                })
              }
              meals={mealItems}
              onOpenDay={openDay}
              onEditDay={editDay}
            />
          )}
          {active === "레시피" && (
            <Recipes
              recipes={recipes}
              weekStart={currentWeek}
              onRegenerate={() =>
                setAgentRequest({
                  action: "REGENERATE_RECIPES",
                  weekStart: currentWeek,
                  prompt: `${currentWeek}부터 ${addDaysLocal(currentWeek, 6)}까지의 식단 메뉴는 변경하지 말고, 이 주차의 주찬·부찬·필요한 주말 점심 레시피만 새로 생성해줘. 해당 주차에 속하지 않는 기존 레시피는 건드리지 말고, 각 메뉴마다 실제로 확인한 블로그 원문을 근거로 정확한 분량, 번호 조리 순서, 아기 분리 조리, 보관 방법을 작성해 전체 주차 검증 후 게시해줘. 장보기는 이 요청에서 변경하지 마.`,
                })
              }
            />
          )}
          {active === "장보기" && (
            <GroceryList
              grocery={grocery}
              setGrocery={setGrocery}
              weekStart={selectedWeek}
              onChangeWeek={changeWeek}
              onChanged={() => setRefreshVersion((version) => version + 1)}
              onRegenerate={() =>
                setAgentRequest({
                  action: "REGENERATE_GROCERY",
                  weekStart: selectedWeek,
                  prompt: `${selectedWeek}부터 ${addDaysLocal(selectedWeek, 6)}까지의 메뉴와 레시피는 변경하지 말고, 이미 저장되어 있고 검증된 이 주차 레시피를 합산해 장보기만 다시 계산해줘. 보유 재료와 기본 양념을 차감하고, 레시피가 빠진 메뉴가 있으면 임의로 생성하지 말고 실패 사유를 알려줘.`,
                })
              }
            />
          )}
          {active === "주간 점검" && (
            <WeeklyReviewSettings
              onRequest={(request) =>
                setAgentRequest({
                  action: "REVIEW_WEEK",
                  weekStart: request.weekStart,
                  prompt: request.prompt,
                })
              }
            />
          )}
        </div>
      </section>
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-20 grid h-14 w-14 place-items-center rounded-full bg-[#0d1247] text-white shadow-[0_10px_28px_rgba(13,18,71,.24)] transition-[transform,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#171e62] hover:shadow-[0_14px_32px_rgba(13,18,71,.28)] active:translate-y-0 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0075de]/45 focus:ring-offset-2 focus:ring-offset-[#f6f5f4]"
        aria-label="AI 채팅 열기"
        aria-expanded={chatOpen}
        title="AI 채팅"
      >
        <Bot size={25} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {selectedDate && (
        <DayDetailModal
          date={selectedDate}
          close={() => setSelectedDate(null)}
          onEdit={() => editDay(selectedDate)}
        />
      )}
      {agentRequest && (
        <AgentModal
          request={agentRequest}
          close={() => setAgentRequest(null)}
          onPublished={() => setRefreshVersion((version) => version + 1)}
          onQueued={queueAgentJob}
        />
      )}
      {chatOpen && (
        <ChatModal
          close={() => setChatOpen(false)}
          onQueued={queueAgentChat}
          targetMonth={selectedMonth}
        />
      )}
      <AgentCompletionMonitor jobs={pendingJobs} onFinished={finishAgentJob} />
      <AgentChatCompletionMonitor chats={pendingChats} onFinished={finishAgentChat} />
      <NotificationPermissionPrompt />
      {appNotice && <InAppNotice message={appNotice} close={() => setAppNotice(null)} />}
    </main>
  );
}

function AgentCompletionMonitor({ jobs, onFinished }: { jobs: PendingAgentJob[]; onFinished: (requestId: string, message: string) => void }) {
  useEffect(() => {
    if (!jobs.length) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const results = await Promise.all(jobs.map(async (job) => {
        try {
          const params = new URLSearchParams({ requestId: job.requestId });
          if (job.date) params.set("date", job.date);
          const response = await fetch(`/api/agent/meal-plan?${params}`, { cache: "no-store" });
          if (!response.ok) return null;
          const data = (await response.json()) as { status?: string; message?: string };
          return data.status === "COMPLETED" || data.status === "FAILED" ? { requestId: job.requestId, message: data.message ?? "AI 작업이 완료되었습니다." } : null;
        } catch { return null; }
      }));
      if (cancelled) return;
      results.filter(Boolean).forEach((result) => onFinished(result!.requestId, result!.message));
      if (!cancelled) timer = window.setTimeout(poll, 3_000);
    };
    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [jobs, onFinished]);
  return null;
}

function AgentChatCompletionMonitor({ chats, onFinished }: { chats: PendingAgentChat[]; onFinished: (id: string, message: string) => void }) {
  useEffect(() => {
    if (!chats.length) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const results = await Promise.all(chats.map(async (chat) => {
        try {
          const response = await fetch(`/api/agent/meal-chat?id=${encodeURIComponent(chat.id)}`, { cache: "no-store" });
          if (!response.ok) return null;
          const data = (await response.json()) as { status?: string; error?: string };
          return data.status === "COMPLETED" || data.status === "FAILED" ? { id: chat.id, message: data.status === "COMPLETED" ? "AI 답변이 도착했습니다." : (data.error ?? "AI 답변을 완료하지 못했습니다.") } : null;
        } catch { return null; }
      }));
      if (cancelled) return;
      results.filter(Boolean).forEach((result) => onFinished(result!.id, result!.message));
      if (!cancelled) timer = window.setTimeout(poll, 3_000);
    };
    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [chats, onFinished]);
  return null;
}

function NotificationPermissionPrompt() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (localStorage.getItem("meal-push-choice") || !window.isSecureContext || !("Notification" in window) || Notification.permission !== "default") return;
    fetch("/api/push/config").then((response) => response.ok ? response.json() : null).then((data) => setOpen(Boolean(data?.configured && data.publicKey))).catch(() => undefined);
  }, []);
  const subscribe = async () => {
    setBusy(true); setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { localStorage.setItem("meal-push-choice", "denied"); setOpen(false); return; }
      const config = await fetch("/api/push/config").then((response) => { if (!response.ok) throw new Error("알림 설정을 불러오지 못했습니다."); return response.json() as Promise<{ publicKey: string }>; });
      const registration = await navigator.serviceWorker.register("/push-worker.js");
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) });
      const response = await fetch("/api/push/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription) });
      if (!response.ok) throw new Error("알림 수신 등록에 실패했습니다.");
      localStorage.setItem("meal-push-choice", "granted"); setOpen(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "알림 수신 등록에 실패했습니다."); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  const dismiss = () => { localStorage.setItem("meal-push-choice", "later"); setOpen(false); };
  return (
    <Dialog onClose={dismiss} labelledBy="push-permission-title" className="max-w-md">
      <CardContent className="p-6">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e6f3fe] text-[#0075de]"><MessageCircle size={20} /></div>
        <h2 id="push-permission-title" className="mt-4 text-xl font-semibold tracking-tight">AI 작업 완료 알림을 받을까요?</h2>
        <p className="mt-2 text-sm leading-6 text-black/60">식단·레시피·장보기 작업이 끝나면 앱을 닫아도 이 기기로 알려드려요.</p>
        {message && <p className="mt-3 text-sm text-[#b42318]" role="status">{message}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={busy} onClick={dismiss}>나중에</Button>
          <Button disabled={busy} onClick={() => void subscribe()}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Check size={16} />}알림 받기</Button>
        </div>
      </CardContent>
    </Dialog>
  );
}

function InAppNotice({ message, close }: { message: string; close: () => void }) {
  return <div role="status" className="fixed bottom-24 right-4 z-[60] flex max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border border-black/[.08] bg-white px-4 py-3 text-sm text-black/75 shadow-[0_8px_24px_rgba(0,0,0,.12)] sm:right-5"><Sparkles className="mt-0.5 shrink-0 text-[#0075de]" size={17} /><p>{message}</p><button type="button" onClick={close} className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-black/45 hover:bg-black/[.05]" aria-label="알림 닫기"><X size={16} /></button></div>;
}

function urlBase64ToUint8Array(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function PageTitle({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-1 text-sm text-black/60">{label}</p>
        <h1 className="text-[28px] font-semibold tracking-[-.035em] md:text-[32px]">
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}

function WeekActions({
  onChangeWeek,
  onRegenerate,
  regenerateLabel,
}: {
  onChangeWeek?: (amount: number) => void;
  onRegenerate: () => void;
  regenerateLabel: string;
}) {
  const controlClass =
    "grid h-11 w-11 place-items-center rounded-lg border border-black/[.08] bg-white text-black/60 transition-colors hover:bg-[#e6f3fe] hover:text-[#0075de] focus:outline-none focus:ring-2 focus:ring-[#0075de]/40";
  return (
    <div className="flex items-center gap-1">
      {onChangeWeek && (
        <>
          <button
            type="button"
            onClick={() => onChangeWeek(-1)}
            className={controlClass}
            aria-label="이전 주"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            onClick={() => onChangeWeek(1)}
            className={controlClass}
            aria-label="다음 주"
          >
            <ChevronRight size={17} />
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onRegenerate}
        className={`${controlClass} ${onChangeWeek ? "ml-1" : ""}`}
        title={regenerateLabel}
        aria-label={regenerateLabel}
      >
        <RefreshCw size={17} />
      </button>
    </div>
  );
}
function MealPlanner({
  view,
  setView,
  month,
  weekStart,
  onChangeMonth,
  onGoToday,
  todayScrollRequest,
  onGenerateMonth,
  meals,
  onOpenDay,
  onEditDay,
}: {
  view: "month" | "week";
  setView: (v: "month" | "week") => void;
  month: string;
  weekStart: string;
  onChangeMonth: (amount: number) => void;
  onGoToday: () => void;
  todayScrollRequest: number;
  onGenerateMonth: () => void;
  meals: Meal[];
  onOpenDay: (date: string) => void;
  onEditDay: (date: string) => void;
}) {
  const weekDays = buildWeekDays(weekStart);
  const periodLabel =
    view === "month" ? formatMonth(month) : formatWeekRangeLong(weekStart);
  const monthHasMeals = meals.some((meal) => meal.date.startsWith(`${month}-`));
  const generateMonthLabel = monthHasMeals
    ? `${formatMonth(month)} 식단이 이미 있습니다`
    : `${formatMonth(month)} 월간 식단 생성 테스트`;
  return (
    <>
      <PageTitle
        label="식단 플래너"
        title={view === "month" ? `${month.slice(5)}월의 식단` : "이번 주 식단"}
      >
        <div
          className="flex rounded-lg border border-black/[.08] bg-white p-1"
          role="group"
          aria-label="식단 보기 방식"
        >
          <button
            type="button"
            onClick={() => setView("month")}
            aria-pressed={view === "month"}
            className={`rounded-md px-3 py-1.5 text-sm ${view === "month" ? "bg-[#e6f3fe] text-[#0075de]" : "text-black/60"}`}
          >
            월간
          </button>
          <button
            type="button"
            onClick={() => setView("week")}
            aria-pressed={view === "week"}
            className={`rounded-md px-3 py-1.5 text-sm ${view === "week" ? "bg-[#e6f3fe] text-[#0075de]" : "text-black/60"}`}
          >
            주간
          </button>
        </div>
      </PageTitle>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[.08] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            {view === "month" && (
              <button
                type="button"
                onClick={() => onChangeMonth(-1)}
                className="grid h-11 w-11 place-items-center rounded-lg hover:bg-black/[.04] focus:outline-none focus:ring-2 focus:ring-[#0075de]/40"
                aria-label="이전 달"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 className="min-w-[126px] text-center font-semibold tabular-nums sm:min-w-[150px]">
              {periodLabel}
            </h2>
            {view === "month" && (
              <button
                type="button"
                onClick={() => onChangeMonth(1)}
                className="grid h-11 w-11 place-items-center rounded-lg hover:bg-black/[.04] focus:outline-none focus:ring-2 focus:ring-[#0075de]/40"
                aria-label="다음 달"
              >
                <ChevronRight size={18} />
              </button>
            )}
          </div>
          {view === "month" && (
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onGoToday}
                className="h-11 px-3 lg:hidden"
              >
                오늘
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={monthHasMeals}
                onClick={onGenerateMonth}
                className="h-11 w-11 shrink-0 px-0 sm:w-auto sm:px-3"
                aria-label={generateMonthLabel}
                title={generateMonthLabel}
              >
                <Sparkles size={16} />
                <span className="hidden sm:inline">월간 생성 테스트</span>
              </Button>
            </div>
          )}
        </div>
        {view === "month" ? (
          <>
            <div className="lg:hidden">
              <MobileMealList
                days={buildMonthDays(month).filter((cell) => cell.current)}
                meals={meals}
                onOpenDay={onOpenDay}
                today={currentKstDate()}
                todayScrollRequest={todayScrollRequest}
                autoScrollToToday
              />
            </div>
            <div className="hidden lg:block">
              <MonthView
                month={month}
                meals={meals}
                onOpenDay={onOpenDay}
                onEditDay={onEditDay}
              />
            </div>
          </>
        ) : (
          <>
            <div className="lg:hidden">
              <MobileMealList
                days={weekDays}
                meals={meals}
                onOpenDay={onOpenDay}
              />
            </div>
            <div className="hidden lg:block">
              <WeekView
                days={weekDays}
                meals={meals}
                onOpenDay={onOpenDay}
                onEditDay={onEditDay}
              />
            </div>
          </>
        )}
      </Card>
    </>
  );
}
function MealCard({ meal, onEdit }: { meal: Meal; onEdit: () => void }) {
  return (
    <div
      className={`group relative mt-2 rounded-md px-2 py-1.5 text-[11px] leading-tight break-keep ${meal.color}`}
    >
      <button
        type="button"
        onClick={onEdit}
        className="absolute right-1 top-1 hidden h-8 w-8 place-items-center rounded text-black/35 hover:bg-white/70 hover:text-[#0075de] focus:grid lg:grid lg:opacity-0 lg:group-hover:opacity-100"
        aria-label={`${meal.day}일 식단 수정`}
      >
        <Pencil size={12} />
      </button>
      <span className="block pr-5 text-black/45">{meal.type}</span>
      <b className="block font-medium">주찬 · {meal.main}</b>
      {meal.sides.map((side) => (
        <span key={side} className="mt-0.5 block text-black/60">
          부찬 · {side}
        </span>
      ))}
    </div>
  );
}
function MonthView({
  month,
  meals,
  onOpenDay,
  onEditDay,
}: {
  month: string;
  meals: Meal[];
  onOpenDay: (date: string) => void;
  onEditDay: (date: string) => void;
}) {
  return (
    <div className="grid min-w-[728px] grid-cols-7">
      {["일", "월", "화", "수", "목", "금", "토"].map((x) => (
        <div
          className="border-b border-r border-black/[.08] px-3 py-2 text-xs font-medium text-black/55"
          key={x}
        >
          {x}
        </div>
      ))}
      {buildMonthDays(month).map((cell, index) => {
        const meal = cell.current
          ? meals.find((item) => item.date === cell.date)
          : undefined;
        return (
          <div
            className={`calendar-cell ${cell.current ? "" : "bg-black/[.015] text-black/30"}`}
            key={`${cell.date}-${index}`}
          >
            <button
              type="button"
              onClick={() => cell.current && onOpenDay(cell.date)}
              disabled={!cell.current}
              className="grid h-7 w-7 place-items-center rounded-lg text-xs hover:bg-black/[.04] focus:outline-none focus:ring-2 focus:ring-[#0075de]/40"
              aria-label={`${cell.date} 식단 상세 보기`}
            >
              {cell.day}
            </button>
            {meal && (
              <MealCard meal={meal} onEdit={() => onEditDay(cell.date)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
function MobileMealList({
  days,
  meals,
  onOpenDay,
  today,
  todayScrollRequest = 0,
  autoScrollToToday = false,
}: {
  days: ReturnType<typeof buildMonthDays>;
  meals: Meal[];
  onOpenDay: (date: string) => void;
  today?: string;
  todayScrollRequest?: number;
  autoScrollToToday?: boolean;
}) {
  const todayRef = useRef<HTMLDivElement>(null);
  const didAutoScroll = useRef(false);
  useEffect(() => {
    if (
      !autoScrollToToday ||
      !today ||
      !todayRef.current ||
      !window.matchMedia("(max-width: 1023px)").matches
    )
      return;
    if (didAutoScroll.current && todayScrollRequest === 0) return;
    const frame = window.requestAnimationFrame(() => {
      todayRef.current?.scrollIntoView({
        behavior: todayScrollRequest > 0 ? "smooth" : "auto",
        block: "center",
      });
      didAutoScroll.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoScrollToToday, today, todayScrollRequest]);
  return (
    <div className="space-y-2 p-3">
      {days.map((cell) => {
        const meal = meals.find((item) => item.date === cell.date);
        return (
          <div
            key={cell.date}
            ref={cell.date === today ? todayRef : undefined}
            className={`flex w-full items-start gap-3 rounded-xl p-4 text-left ${meal ? meal.color : "bg-[#f6f5f4] text-black/50"}`}
          >
            <span className="flex min-w-11 flex-col items-center text-sm font-medium text-black/60">
              <span>{weekdayFor(cell.date)}</span>
              <button
                type="button"
                onClick={() => onOpenDay(cell.date)}
                className={`mt-1 grid h-11 w-11 place-items-center rounded-lg text-base font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#0075de]/40 ${cell.date === today ? "bg-white/80 text-[#0075de] ring-1 ring-[#0075de]/20" : "text-black/75 hover:bg-white/55"}`}
                aria-label={`${cell.date} 식단 상세 보기`}
                aria-current={cell.date === today ? "date" : undefined}
              >
                {cell.day}
              </button>
            </span>
            {meal ? (
              <span className="min-w-0 flex-1">
                <b className="block break-keep text-[15px] leading-5">
                  {meal.main}
                </b>
                <span className="mt-1 block break-keep text-sm leading-5 text-black/65">
                  {meal.sides.join(" · ")}
                </span>
              </span>
            ) : (
              <span className="pt-0.5 text-sm">식단 없음</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
function WeekView({
  days,
  meals,
  onOpenDay,
  onEditDay,
}: {
  days: ReturnType<typeof buildWeekDays>;
  meals: Meal[];
  onOpenDay: (date: string) => void;
  onEditDay: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-7">
      {days.map((cell) => {
        const meal = meals.find((item) => item.date === cell.date);
        return (
          <div
            key={cell.date}
            className="min-h-[420px] border-r border-black/[.08] p-3 last:border-0"
          >
            <span className="block text-center text-xs text-black/55">
              {weekdayFor(cell.date)}
            </span>
            <button
              type="button"
              onClick={() => onOpenDay(cell.date)}
              className="mx-auto mt-1 grid h-7 w-7 place-items-center rounded-full text-sm transition-colors hover:bg-black/[.04] focus:outline-none focus:ring-2 focus:ring-[#0075de]/40"
              aria-label={`${cell.date} 식단 상세 보기`}
            >
              {cell.day}
            </button>
            {meal && (
              <MealCard meal={meal} onEdit={() => onEditDay(cell.date)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
function Recipes({
  recipes,
  weekStart,
  onRegenerate,
}: {
  recipes: Recipe[];
  weekStart: string;
  onRegenerate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"전체" | "주찬" | "부찬">("전체");
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const filtered = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          (category === "전체" || recipe.category === category) &&
          (recipe.title.includes(query) ||
            recipe.tags.some((tag) => tag.includes(query))),
      ),
    [category, query, recipes],
  );
  return (
    <>
      <PageTitle label={`${formatWeekRange(weekStart)} 레시피`} title="레시피">
        <WeekActions
          onRegenerate={onRegenerate}
          regenerateLabel="이번 주 레시피 재생성"
        />
      </PageTitle>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex w-fit rounded-lg border border-black/[.1] bg-white p-1"
          role="tablist"
          aria-label="레시피 종류"
        >
          {(["전체", "주찬", "부찬"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={category === tab}
              onClick={() => setCategory(tab)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${category === tab ? "bg-[#e6f3fe] text-[#0075de]" : "text-black/60 hover:bg-[#f6f5f4] hover:text-black"}`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex w-full max-w-md items-center gap-2 rounded-lg border border-black/[.1] bg-white px-3">
          <Search size={17} className="text-black/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full bg-transparent text-base outline-none sm:text-sm"
            placeholder="레시피 검색"
            aria-label="레시피 검색"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((recipe) => (
          <Card
            key={recipe.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedRecipe(recipe)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedRecipe(recipe);
              }
            }}
            className="cursor-pointer overflow-hidden transition-colors hover:border-black/20 focus:outline-none focus:ring-2 focus:ring-[#0075de]/40"
          >
            <div className={`grid h-24 place-items-center ${recipe.color}`}>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-white/70 text-black/65">
                <ChefHat size={22} />
              </span>
            </div>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-[#0075de]">
                {formatRecipeDates(recipe.plannedDates)}
              </p>
              <div className="mt-2">
                <p className="font-medium">{recipe.title}</p>
                <p className="mt-1 text-sm text-black/55">{recipe.meta}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {recipe.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[#f6f5f4] px-2 py-1 text-[11px] text-black/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              {recipe.sourceUrl && (
                <a
                  onClick={(event) => event.stopPropagation()}
                  href={recipe.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex items-center gap-1 text-xs font-medium text-[#0075de] hover:underline"
                  title={recipe.sourceTitle ?? undefined}
                >
                  <ExternalLink size={13} />
                  {recipe.sourceAuthor
                    ? `${recipe.sourceAuthor} 블로그 원문`
                    : "블로그 원문 보기"}
                </a>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {!filtered.length && (
        <p className="rounded-xl border border-dashed border-black/[.12] p-8 text-center text-sm text-black/55">
          표시할 {category === "전체" ? "레시피" : category}이 없습니다.
        </p>
      )}
      {selectedRecipe && (
        <RecipeModal
          recipe={selectedRecipe}
          close={() => setSelectedRecipe(null)}
        />
      )}
    </>
  );
}
function RecipeModal({ recipe, close }: { recipe: Recipe; close: () => void }) {
  return (
    <Dialog
      onClose={close}
      labelledBy="recipe-dialog-title"
      className="max-w-xl"
    >
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-black/55">레시피</p>
            <h2
              id="recipe-dialog-title"
              className="mt-1 text-2xl font-semibold tracking-tight"
            >
              {recipe.title}
            </h2>
            <p className="mt-2 text-sm text-black/60">
              {recipe.meta} · 준비 {recipe.prepMinutes ?? 0}분 · 조리{" "}
              {recipe.cookMinutes ?? 0}분
            </p>
          </div>
          <button
            data-autofocus
            type="button"
            onClick={close}
            className="grid h-11 w-11 place-items-center rounded-lg text-xl text-black/50 hover:bg-black/[.05]"
            aria-label="레시피 닫기"
          >
            ×
          </button>
        </div>
        {recipe.description && (
          <p className="mt-5 text-sm leading-6 text-black/70">
            {recipe.description}
          </p>
        )}
        <section className="mt-6">
          <p className="text-xs font-semibold tracking-[.08em] text-black/55">
            재료
          </p>
          {recipe.ingredients?.length ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {recipe.ingredients.map((ingredient) => (
                <div
                  key={`${ingredient.name}-${ingredient.amount}`}
                  className="flex items-center justify-between rounded-lg bg-[#f6f5f4] px-3 py-2 text-sm"
                >
                  <span>{ingredient.name}</span>
                  <span className="text-black/60">{ingredient.amount}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-black/55">
              재료 정보가 아직 등록되지 않았습니다.
            </p>
          )}
        </section>
        <section className="mt-6">
          <p className="text-xs font-semibold tracking-[.08em] text-black/55">
            조리 방법
          </p>
          {recipe.instructions?.length ? (
            <ol className="mt-3 space-y-3">
              {recipe.instructions.map((step, index) => (
                <li
                  key={`${index}-${step}`}
                  className="flex gap-3 text-sm leading-6"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e6f3fe] text-xs font-semibold text-[#0075de]">
                    {index + 1}
                  </span>
                  <span>{step.replace(/^\d+[.)]\s*/, "")}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-black/55">
              조리 순서가 아직 등록되지 않았습니다. 원문 레시피를 확인해 주세요.
            </p>
          )}
        </section>
        {recipe.babySplitStep && (
          <section className="mt-6 rounded-xl bg-[#fff0d4] p-4">
            <p className="text-xs font-semibold tracking-[.08em] text-[#765000]">
              아기 분리 조리
            </p>
            <p className="mt-2 text-sm leading-6 text-black/70">
              {recipe.babySplitStep}
            </p>
          </section>
        )}
        {(recipe.storageMethod || recipe.consumeWithin) && (
          <p className="mt-5 text-sm text-black/60">
            보관 · {recipe.storageMethod ?? "-"}
            {recipe.consumeWithin ? ` / ${recipe.consumeWithin} 내 섭취` : ""}
          </p>
        )}
        {recipe.sourceUrl && (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-5 flex items-center gap-1 text-sm font-medium text-[#0075de] hover:underline"
          >
            <ExternalLink size={15} />
            {recipe.sourceAuthor
              ? `${recipe.sourceAuthor} 블로그 원문 보기`
              : "블로그 원문 보기"}
          </a>
        )}
      </CardContent>
    </Dialog>
  );
}
function GroceryList({
  grocery,
  setGrocery,
  weekStart,
  onChangeWeek,
  onChanged,
  onRegenerate,
}: {
  grocery: Grocery[];
  setGrocery: React.Dispatch<React.SetStateAction<Grocery[]>>;
  weekStart: string;
  onChangeWeek: (amount: number) => void;
  onChanged: () => void;
  onRegenerate: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("기타");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const remaining = grocery.filter((i) => !i.done).length;
  const request = async (url: string, init: RequestInit) => {
    const response = await fetch(url, init);
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? "장보기 항목을 저장하지 못했습니다.");
    return data;
  };
  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await request("/api/grocery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart, name, category }),
      });
      setName("");
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "품목을 추가하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (item: Grocery) => {
    const next = !item.done;
    setGrocery((all) =>
      all.map((value) =>
        value.id === item.id ? { ...value, done: next } : value,
      ),
    );
    try {
      await request("/api/grocery", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: String(item.id), purchased: next }),
      });
    } catch (error) {
      setGrocery((all) =>
        all.map((value) =>
          value.id === item.id ? { ...value, done: item.done } : value,
        ),
      );
      setMessage(
        error instanceof Error
          ? error.message
          : "완료 상태를 저장하지 못했습니다.",
      );
    }
  };
  const remove = async (item: Grocery) => {
    const previous = grocery;
    setGrocery((all) => all.filter((value) => value.id !== item.id));
    try {
      await request(`/api/grocery?id=${encodeURIComponent(String(item.id))}`, {
        method: "DELETE",
      });
    } catch (error) {
      setGrocery(previous);
      setMessage(
        error instanceof Error ? error.message : "품목을 삭제하지 못했습니다.",
      );
    }
  };
  const groups = grocery.reduce<Record<string, Grocery[]>>(
    (acc, item) => ({
      ...acc,
      [item.category]: [...(acc[item.category] ?? []), item],
    }),
    {},
  );
  return (
    <>
      <PageTitle
        label={`${formatWeekRange(weekStart)} 필요한 재료`}
        title="장보기"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-1 text-sm text-black/55">{remaining}개 남음</span>
          <WeekActions
            onChangeWeek={onChangeWeek}
            onRegenerate={onRegenerate}
            regenerateLabel="이번 주 준비된 레시피로 장보기 재계산"
          />
        </div>
      </PageTitle>
      <Card>
        <CardContent>
          <div className="mb-6 flex flex-wrap gap-2">
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              className="h-11 min-w-[180px] flex-1 rounded-lg border border-black/10 px-3 text-base outline-none focus:border-[#0075de] sm:text-sm"
              placeholder="장보기 품목 입력"
              aria-label="장보기 품목명"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-11 rounded-lg border border-black/10 bg-white px-3 text-base sm:text-sm"
              aria-label="장보기 분류"
            >
              <option>채소</option>
              <option>정육</option>
              <option>유제품</option>
              <option>냉장</option>
              <option>양념</option>
              <option>기타</option>
            </select>
            <Button
              disabled={busy || !name.trim()}
              onClick={() => void add()}
              className="h-11"
            >
              <Plus size={16} />
              {busy ? "저장 중" : "추가"}
            </Button>
          </div>
          {message && (
            <p
              className="mb-4 rounded-lg bg-[#fff0d4] p-3 text-sm text-[#5f4300]"
              role="status"
            >
              {message}
            </p>
          )}
          {Object.entries(groups).map(([group, items]) => (
            <section key={group} className="mb-6 last:mb-0">
              <p className="mb-2 text-xs font-semibold tracking-[.08em] text-black/55">
                {group}
              </p>
              {items.map((item) => (
                <div
                  className="flex items-center gap-2 border-t border-black/[.07] py-2"
                  key={item.id}
                >
                  <button
                    type="button"
                    onClick={() => void toggle(item)}
                    aria-pressed={item.done}
                    aria-label={`${item.name} ${item.done ? "미구매로 변경" : "구매 완료"}`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-black/[.04] focus:outline-none focus:ring-2 focus:ring-[#0075de]/40"
                  >
                    <span
                      className={`grid h-5 w-5 place-items-center rounded border ${item.done ? "border-[#0075de] bg-[#0075de] text-white" : "border-black/30"}`}
                    >
                      {item.done && <Check size={13} />}
                    </span>
                  </button>
                  <span
                    className={`min-w-0 flex-1 text-sm ${item.done ? "text-black/50 line-through" : ""}`}
                  >
                    {item.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-black/45 hover:bg-black/[.04] hover:text-[#e32d14] focus:outline-none focus:ring-2 focus:ring-[#0075de]/40"
                    aria-label={`${item.name} 삭제`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </section>
          ))}
          {!grocery.length && (
            <p className="py-8 text-center text-sm text-black/55">
              이 주차에 저장된 장보기 항목이 없습니다.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
function WeeklyReviewSettings({
  onRequest,
}: {
  onRequest: (request: WeeklyReviewRequest) => void;
}) {
  const [referenceDate, setReferenceDate] = useState(nextSunday());
  const [wantedFoods, setWantedFoods] = useState("");
  const [avoidFoods, setAvoidFoods] = useState("");
  const [note, setNote] = useState("");
  const [pantry, setPantry] = useState<
    {
      name: string;
      quantity: string;
      unit: string;
      category: string;
      expiresAt: string;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const saved = window.localStorage.getItem("weekly-review-reference-date");
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) setReferenceDate(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("weekly-review-reference-date", referenceDate);
    setLoading(true);
    fetch(`/api/weekly-review?date=${referenceDate}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        const review = data.review;
        setWantedFoods(review?.wantedFoods ?? "");
        setAvoidFoods(review?.avoidFoods ?? "");
        setNote(review?.note ?? "");
        setPantry(
          (data.pantry ?? []).map(
            (item: {
              name: string;
              quantity: number;
              unit: string;
              category: string;
              expiresAt?: string | null;
            }) => ({
              name: item.name,
              quantity: String(item.quantity),
              unit: item.unit,
              category: item.category,
              expiresAt: item.expiresAt ?? "",
            }),
          ),
        );
      })
      .catch(() => setMessage("점검 정보를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [referenceDate]);
  const save = async (requestAgent: boolean) => {
    const weekStart = sundayFor(referenceDate);
    const endDate = addDaysLocal(weekStart, 6);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/weekly-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceDate,
          wantedFoods,
          avoidFoods,
          note,
          pantry: pantry
            .filter((item) => item.name.trim())
            .map((item) => ({ ...item, quantity: Number(item.quantity) })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "저장하지 못했습니다.");
      if (requestAgent)
        onRequest({
          weekStart,
          referenceDate,
          prompt: `주간 점검을 진행해줘. 판단 및 수정 범위는 ${referenceDate}부터 ${endDate}(토요일)까지다. weeklyReview와 pantry, 날짜 상세에 저장된 저녁 외식·가족별 점심/저녁 미식사 일정을 기준으로 유통기한 임박 재료와 식사 인원을 판단해. 기준 날짜 이전의 같은 주 식단은 변경하지 마. 특이사항이 없으면 현재 식단을 유지하고, 조정이 필요할 때만 해당 범위의 식단·레시피·장보기를 검증 후 게시해줘.`,
        });
      else setMessage("점검 정보가 저장됐어요.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  const updatePantry = (
    index: number,
    field: "name" | "quantity" | "unit" | "category" | "expiresAt",
    value: string,
  ) =>
    setPantry((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  return (
    <>
      <PageTitle label="매주 토요일 저녁 8시 점검" title="다음 주 식단 점검" />
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">판단 시작 날짜</p>
              <p className="mt-1 text-sm text-black/50">
                날짜를 바꾸면 그날부터 같은 주 토요일까지만 판단합니다. 외식과
                식사 인원은 날짜 상세에서 체크해 주세요.
              </p>
            </div>
            <input
              type="date"
              value={referenceDate}
              onChange={(event) => setReferenceDate(event.target.value)}
              className="h-10 rounded-lg border border-black/[.12] bg-white px-3 text-sm outline-none focus:border-[#0075de]"
            />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              먹고 싶은 메뉴
              <textarea
                value={wantedFoods}
                onChange={(event) => setWantedFoods(event.target.value)}
                className="mt-2 h-20 w-full resize-none rounded-lg border border-black/[.12] p-3 font-normal outline-none focus:border-[#0075de]"
                placeholder="예: 카레, 생선구이"
              />
            </label>
            <label className="text-sm font-medium">
              피하고 싶은 메뉴
              <textarea
                value={avoidFoods}
                onChange={(event) => setAvoidFoods(event.target.value)}
                className="mt-2 h-20 w-full resize-none rounded-lg border border-black/[.12] p-3 font-normal outline-none focus:border-[#0075de]"
                placeholder="예: 매운 음식, 면"
              />
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium">
            추가 메모
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 h-20 w-full resize-none rounded-lg border border-black/[.12] p-3 font-normal outline-none focus:border-[#0075de]"
              placeholder="컨디션, 냉장고 정리처럼 식단에 반영할 내용"
            />
          </label>
        </CardContent>
      </Card>
      <Card className="mt-5">
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">냉장고·팬트리 현황</p>
              <p className="mt-1 text-sm text-black/50">
                유통기한을 넣으면 AI가 먼저 써야 할 재료를 더 정확히 판단합니다.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                setPantry((items) => [
                  ...items,
                  {
                    name: "",
                    quantity: "",
                    unit: "g",
                    category: "냉장",
                    expiresAt: "",
                  },
                ])
              }
            >
              <Plus size={16} />
              재료 추가
            </Button>
          </div>
          <div className="mt-5 space-y-2">
            {loading ? (
              <p className="py-5 text-sm text-black/45">불러오는 중...</p>
            ) : pantry.length ? (
              pantry.map((item, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-xl bg-[#f6f5f4] p-3 sm:grid-cols-[1.5fr_.7fr_.7fr_1fr_1.2fr_auto]"
                >
                  <input
                    value={item.name}
                    onChange={(event) =>
                      updatePantry(index, "name", event.target.value)
                    }
                    className="h-9 rounded-lg border border-black/[.1] bg-white px-2 text-sm"
                    placeholder="재료명"
                  />
                  <input
                    value={item.quantity}
                    onChange={(event) =>
                      updatePantry(index, "quantity", event.target.value)
                    }
                    className="h-9 rounded-lg border border-black/[.1] bg-white px-2 text-sm"
                    type="number"
                    min="0"
                    placeholder="수량"
                  />
                  <input
                    value={item.unit}
                    onChange={(event) =>
                      updatePantry(index, "unit", event.target.value)
                    }
                    className="h-9 rounded-lg border border-black/[.1] bg-white px-2 text-sm"
                    placeholder="단위"
                  />
                  <input
                    value={item.category}
                    onChange={(event) =>
                      updatePantry(index, "category", event.target.value)
                    }
                    className="h-9 rounded-lg border border-black/[.1] bg-white px-2 text-sm"
                    placeholder="보관"
                  />
                  <input
                    value={item.expiresAt}
                    onChange={(event) =>
                      updatePantry(index, "expiresAt", event.target.value)
                    }
                    className="h-9 rounded-lg border border-black/[.1] bg-white px-2 text-sm"
                    type="date"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setPantry((items) =>
                        items.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    className="grid h-9 w-9 place-items-center rounded-lg text-black/35 hover:bg-white hover:text-[#e32d14]"
                    aria-label={`${item.name || "재료"} 삭제`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <p className="rounded-xl bg-[#f6f5f4] p-5 text-sm text-black/45">
                남은 재료를 추가해 주세요.
              </p>
            )}
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => void save(false)}
            >
              정보 저장
            </Button>
            <Button disabled={saving} onClick={() => void save(true)}>
              <Sparkles size={16} />
              {saving ? "저장 중..." : "저장하고 AI에게 판단 요청"}
            </Button>
          </div>
          {message && <p className="mt-3 text-sm text-[#075f9f]">{message}</p>}
        </CardContent>
      </Card>
    </>
  );
}
function DayDetailModal({
  date,
  close,
  onEdit,
}: {
  date: string;
  close: () => void;
  onEdit: () => void;
}) {
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    setDetail(null);
    return fetch(`/api/day-details?date=${date}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setDetail)
      .catch(() => setError("날짜 정보를 불러오지 못했습니다."));
  }, [date]);
  useEffect(() => {
    void load();
  }, [load]);
  const updateAttendance = (
    person: keyof DayDetail["attendance"],
    field: keyof Attendance,
    value: boolean,
  ) =>
    setDetail((current) =>
      current
        ? {
            ...current,
            attendance: {
              ...current.attendance,
              [person]: { ...current.attendance[person], [field]: value },
            },
          }
        : current,
    );
  const updateDinnerDiningOut = (value: boolean) =>
    setDetail((current) =>
      current?.meal
        ? { ...current, meal: { ...current.meal, dinnerDiningOut: value } }
        : current,
    );
  const save = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const response = await fetch("/api/day-details", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          dinnerDiningOut: detail.meal?.dinnerDiningOut ?? false,
          attendance: detail.attendance,
          father: detail.attendance.father,
          mother: detail.attendance.mother,
        }),
      });
      if (!response.ok) throw new Error("식사 일정을 저장하지 못했습니다.");
      setDetail(await response.json());
      setError("저장했습니다.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "식사 일정을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog onClose={close} labelledBy="day-detail-title" className="max-w-lg">
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-black/55">{weekdayFor(date)}요일</p>
            <h2
              id="day-detail-title"
              className="mt-1 text-2xl font-semibold tracking-tight"
            >
              {date.replaceAll("-", ".")} 식단
            </h2>
          </div>
          <button
            data-autofocus
            type="button"
            onClick={close}
            className="grid h-11 w-11 place-items-center rounded-lg text-xl text-black/50 hover:bg-black/[.05]"
            aria-label="날짜 상세 닫기"
          >
            ×
          </button>
        </div>
        {!detail ? (
          <div className="py-12 text-center">
            {error ? (
              <>
                <p className="text-sm text-black/60">{error}</p>
                <Button
                  variant="outline"
                  onClick={() => void load()}
                  className="mt-4"
                >
                  다시 불러오기
                </Button>
              </>
            ) : (
              <p className="text-sm text-black/55">식단을 불러오는 중입니다.</p>
            )}
          </div>
        ) : (
          <>
            <section className="mt-6 rounded-xl bg-[#f6f5f4] p-4">
              <p className="text-xs font-semibold tracking-[.08em] text-black/55">
                오늘의 식단
              </p>
              {detail.meal ? (
                <div className="mt-3 space-y-2 text-sm">
                  <p>
                    <span className="text-black/55">점심</span> ·{" "}
                    {detail.meal.lunch ?? "계획 없음"}
                  </p>
                  <p className="font-medium">
                    주찬 · {detail.meal.main ?? "계획 없음"}
                  </p>
                  {detail.meal.sides.map((side) => (
                    <p key={side} className="text-black/70">
                      부찬 · {side}
                    </p>
                  ))}
                  {detail.meal.baby && (
                    <p className="text-black/70">아기 · {detail.meal.baby}</p>
                  )}
                  {detail.meal.note && (
                    <p className="pt-1 text-xs text-black/55">
                      메모 · {detail.meal.note}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-black/55">
                  등록된 식단이 없습니다.
                </p>
              )}
            </section>
            <Button
              variant="outline"
              onClick={onEdit}
              className="mt-3 h-11 w-full gap-2"
            >
              <Pencil size={16} aria-hidden="true" />
              일일 식단 수정
            </Button>
            <section className="mt-4 rounded-xl border border-black/[.08]">
              <div className="border-b border-black/[.08] p-4">
                <h3 className="font-semibold">집에서 먹지 않는 끼니</h3>
                <p className="mt-1 text-sm leading-5 text-black/60">
                  체크한 일정은 다음 식단 검토 때 인원과 장보기에 반영됩니다.
                </p>
              </div>
              <div className="divide-y divide-black/[.07]">
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">가족 저녁</p>
                    <p className="text-xs text-black/55">
                      가족 모두 외식하는 날
                    </p>
                  </div>
                  <ScheduleCheck
                    label="저녁 외식"
                    checked={detail.meal?.dinnerDiningOut ?? false}
                    onChange={updateDinnerDiningOut}
                  />
                </div>
                {(
                  [
                    ["father", "아빠"],
                    ["mother", "엄마"],
                  ] as const
                ).map(([person, label]) => (
                  <div
                    key={person}
                    className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto]"
                  >
                    <p className="text-sm font-medium">{label}</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      <ScheduleCheck
                        label="점심 미식사"
                        checked={detail.attendance[person].lunchNotAtHome}
                        onChange={(value) =>
                          updateAttendance(person, "lunchNotAtHome", value)
                        }
                      />
                      <ScheduleCheck
                        label="저녁 미식사"
                        checked={detail.attendance[person].dinnerNotAtHome}
                        onChange={(value) =>
                          updateAttendance(person, "dinnerNotAtHome", value)
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <Button
              disabled={saving}
              onClick={() => void save()}
              className="mt-4 h-11 w-full"
            >
              {saving ? "저장 중..." : "식사 일정 저장"}
            </Button>
            {error && (
              <p
                className="mt-3 text-center text-sm text-black/60"
                role="status"
              >
                {error}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Dialog>
  );
}

function ScheduleCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-black/70">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#0075de]/40 peer-focus-visible:ring-offset-2 ${checked ? "border-[#0075de] bg-[#0075de] text-white" : "border-black/30 bg-white"}`}
      >
        {checked && <Check size={13} />}
      </span>
      <span>{label}</span>
    </label>
  );
}
function ChatModal({ close, onQueued, targetMonth }: { close: () => void; onQueued: (chat: PendingAgentChat) => void; targetMonth: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "식단을 물어보거나 직접 관리해 보세요. 날짜와 대상을 정확히 적으면 식단 생성·수정, 레시피 추가·삭제, 장보기와 식사 일정까지 반영할 수 있어요.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messageArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messageArea.current?.scrollTo({
      top: messageArea.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);
  const send = async () => {
    const content = input.trim();
    if (!content || loading) return;
    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const response = await fetch("/api/agent/meal-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          targetMonth,
          conversation: messages.slice(-8),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.message ?? data.error ?? "AI가 답변을 처리하지 못했습니다.",
        );
      onQueued({ id: data.id });
      const deadline = Date.now() + 10 * 60_000;
      let result: {
        status?: string;
        answer?: string;
        sources?: ChatMessage["sources"];
        error?: string;
      } | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        const statusResponse = await fetch(
          `/api/agent/meal-chat?id=${encodeURIComponent(data.id)}`,
        );
        if (!statusResponse.ok) continue;
        const nextResult = (await statusResponse.json()) as {
          status?: string;
          answer?: string;
          sources?: ChatMessage["sources"];
          error?: string;
        };
        result = nextResult;
        if (nextResult.status === "COMPLETED" || nextResult.status === "FAILED")
          break;
      }
      if (result?.status === "COMPLETED")
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: result.answer ?? "AI가 빈 답변을 남겼습니다.",
            sources: result.sources,
          },
        ]);
      else
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content:
              result?.error ??
              "AI가 아직 답변을 마치지 못했습니다. 잠시 후 다시 질문해 주세요.",
          },
        ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error ? error.message : "AI에 연결할 수 없습니다.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog
      onClose={close}
      labelledBy="chat-dialog-title"
      className="flex h-[min(680px,calc(100dvh-2rem))] max-w-2xl flex-col overflow-hidden"
    >
      <div className="flex items-start justify-between border-b border-black/[.08] px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-[#0075de]">
            <Bot size={16} />
            <span className="font-medium">AI 채팅</span>
          </div>
          <h2
            id="chat-dialog-title"
            className="mt-1 text-xl font-semibold tracking-tight"
          >
            우리집 식탁에게 물어보기
          </h2>
        </div>
        <button
          data-autofocus
          type="button"
          onClick={close}
          className="grid h-11 w-11 place-items-center rounded-lg text-xl text-black/50 hover:bg-black/[.05]"
          aria-label="AI 채팅 닫기"
        >
          ×
        </button>
      </div>
      <div
        ref={messageArea}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#fcfbfa] p-5"
        aria-live="polite"
      >
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[88%] rounded-xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-[#0d1247] text-white" : "bg-white text-black/75 ring-1 ring-black/[.06]"}`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.sources?.length ? (
                <div className="mt-3 border-t border-black/[.08] pt-2">
                  {message.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs font-medium text-[#0075de] hover:underline"
                    >
                      <ExternalLink size={12} />
                      {source.title ?? "참고 자료"}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm text-black/60 ring-1 ring-black/[.06]">
              <LoaderCircle className="animate-spin" size={15} />
              AI가 확인 중이에요
            </div>
          </div>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="border-t border-black/[.08] bg-white p-3"
      >
        <div className="flex items-end gap-2 rounded-xl border border-black/[.12] bg-[#fcfbfa] p-2 focus-within:border-[#0075de]">
          <textarea
            value={input}
            maxLength={2000}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            disabled={loading}
            className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none placeholder:text-black/45 sm:text-sm"
            placeholder="예: 9월 12일 계란찜 레시피를 삭제해줘"
            aria-label="AI에게 질문하기"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#0d1247] text-white transition-colors hover:bg-[#171e62] disabled:cursor-not-allowed disabled:bg-black/15"
            aria-label="보내기"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="px-1 pt-2 text-[11px] text-black/55">
          선택된 {Number(targetMonth.slice(5))}월 식단을 기준으로 답하고 변경합니다.
        </p>
      </form>
    </Dialog>
  );
}
function AgentModal({
  request,
  close,
  onPublished,
  onQueued,
}: {
  request: AgentRequest;
  close: () => void;
  onPublished: () => void;
  onQueued: (job: PendingAgentJob) => void;
}) {
  const [prompt, setPrompt] = useState(request.prompt);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<DayUpdateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [beforeSnapshot, setBeforeSnapshot] = useState<MealSnapshot | null>(
    null,
  );
  const isMonthRequest = request.action === "PUBLISH_MONTH";
  const description =
    isMonthRequest
      ? `${formatMonth(request.targetMonth!)} 식단만 생성합니다. 레시피와 장보기는 생성하지 않습니다.`
      : request.action === "UPDATE_DAY"
      ? `${request.date} 식단과 그 날짜의 레시피·장보기만 수정합니다.`
      : request.action === "REGENERATE_RECIPES"
        ? "선택한 주차의 메뉴는 유지하고 레시피만 새로 만듭니다."
        : request.action === "REGENERATE_GROCERY"
          ? "준비된 주간 레시피를 합산해 장보기만 다시 계산합니다."
          : "이번 주 식단과 검증된 블로그 레시피·장보기를 준비합니다.";
  const createPlan = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setMessage("");
    setResult(null);
    try {
      const response = await fetch("/api/agent/meal-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          action: request.action,
          date: request.date,
          weekStart: request.weekStart ?? sundayFor(request.date),
          targetMonth: request.targetMonth,
          days: request.action === "UPDATE_DAY" ? 1 : 7,
        }),
      });
      const data = await response.json();
      setMessage(
        response.ok
          ? data.message
          : (data.message ?? data.error ?? "AI 요청에 실패했습니다."),
      );
      if (response.ok && data.requestId) {
        setBeforeSnapshot(data.before ?? null);
        setRequestId(data.requestId);
        onQueued({ requestId: data.requestId, action: request.action, date: request.date });
      }
    } catch {
      setMessage("AI에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const params = new URLSearchParams({ requestId });
        if (request.date) params.set("date", request.date);
        const response = await fetch(`/api/agent/meal-plan?${params}`, {
          cache: "no-store",
        });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setMessage(data.error ?? "AI 작업 상태를 확인하지 못했습니다.");
          setRequestId(null);
          return;
        }
        setMessage(data.message);
        if (data.status === "COMPLETED") {
          if (request.action === "UPDATE_DAY") {
            const after = (data.after ?? null) as MealSnapshot | null;
            setResult({
              changed: Boolean(
                beforeSnapshot &&
                after &&
                JSON.stringify(beforeSnapshot) !== JSON.stringify(after),
              ),
              before: beforeSnapshot,
              after,
            });
          }
          setRequestId(null);
          onPublished();
          return;
        }
        if (data.status === "FAILED") {
          setRequestId(null);
          return;
        }
        timer = setTimeout(poll, 2_500);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 5_000);
      }
    };

    timer = setTimeout(poll, 1_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [beforeSnapshot, onPublished, request.action, request.date, requestId]);
  return (
    <Dialog
      onClose={close}
      labelledBy="agent-dialog-title"
      className="max-w-xl"
    >
      <CardContent>
        <div className="flex items-start justify-between">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0d4]">
            <Sparkles className="text-[#9a6500]" size={20} />
          </div>
          <button
            data-autofocus
            type="button"
            onClick={close}
            className="grid h-11 w-11 place-items-center rounded-lg text-xl text-black/50 hover:bg-black/[.05]"
            aria-label="AI 요청 닫기"
          >
            ×
          </button>
        </div>
        <h2
          id="agent-dialog-title"
          className="mt-5 text-2xl font-semibold tracking-tight"
        >
          {isMonthRequest ? "월간 식단 생성 테스트" : "AI에게 식단 검토 요청"}
        </h2>
        <p className="mt-2 text-sm leading-5 text-black/60">{description}</p>
        <label
          className="mt-5 block text-sm font-medium"
          htmlFor="agent-request-prompt"
        >
          요청 내용
        </label>
        <textarea
          id="agent-request-prompt"
          value={prompt}
          maxLength={4000}
          onChange={(e) => setPrompt(e.target.value)}
          className="mt-2 h-28 w-full resize-none rounded-lg border border-black/[.12] p-3 text-base outline-none focus:border-[#0075de] sm:text-sm"
        />
        <Button
          disabled={!prompt.trim() || loading || Boolean(requestId)}
          onClick={createPlan}
          className="mt-3 h-11 w-full"
        >
          {loading || requestId ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <Sparkles size={16} />
          )}
          {loading
            ? "요청을 전달하고 있어요..."
            : requestId
              ? "백그라운드에서 처리 중"
              : isMonthRequest
                ? "월간 식단 생성하기"
                : "검토 요청하기"}
        </Button>
        {message && (
          <div
            className="mt-4 rounded-lg bg-[#e6f3fe] p-3 text-sm text-[#075f9f]"
            role="status"
          >
            {message}
          </div>
        )}
        {result && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MealSnapshotCard label="변경 전" meal={result.before} />
            <MealSnapshotCard
              label={result.changed ? "변경 후" : "유지"}
              meal={result.after}
              highlight={result.changed}
            />
          </div>
        )}
        <p className="mt-3 text-center text-[11px] text-black/55">
          요청 후 이 창을 닫아도 작업은 계속됩니다. 완료된 변경은 화면을 다시
          열거나 새로고침하면 확인할 수 있습니다.
        </p>
      </CardContent>
    </Dialog>
  );
}

function currentKstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function sundayFor(date = currentKstDate()) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
}
function nextSunday() {
  const today = currentKstDate();
  const value = new Date(`${today}T00:00:00Z`);
  const days = (7 - value.getUTCDay()) % 7 || 7;
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function addDaysLocal(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+09:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}
function shiftMonth(month: string, amount: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function formatMonth(month: string) {
  const [year, value] = month.split("-");
  return `${year}년 ${Number(value)}월`;
}
function formatWeekRange(weekStart: string) {
  const end = addDaysLocal(weekStart, 6);
  return `${weekStart.slice(5).replace("-", "/")}–${end.slice(5).replace("-", "/")}`;
}
function formatWeekRangeLong(weekStart: string) {
  const end = addDaysLocal(weekStart, 6);
  return `${Number(weekStart.slice(5, 7))}월 ${Number(weekStart.slice(8))}일 – ${Number(end.slice(5, 7))}월 ${Number(end.slice(8))}일`;
}
function formatRecipeDates(dates: string[]) {
  const ordered = [...new Set(dates)].sort();
  if (!ordered.length) return "날짜 미지정";
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const label = (date: string) =>
    `${date.slice(5).replace("-", "/")}(${weekdayFor(date)})`;
  return first === last ? label(first) : `${label(first)} – ${label(last)}`;
}
function weekdayFor(date: string) {
  return ["일", "월", "화", "수", "목", "금", "토"][
    new Date(`${date}T12:00:00+09:00`).getUTCDay()
  ];
}
function buildMonthDays(month: string) {
  const [year, value] = month.split("-").map(Number);
  const monthIndex = value - 1;
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const leading = first.getUTCDay();
  const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const length = Math.ceil((leading + count) / 7) * 7;
  return Array.from({ length }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex, index - leading + 1));
    return {
      date: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      current: date.getUTCMonth() === monthIndex,
    };
  });
}
function buildWeekDays(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysLocal(weekStart, index);
    return { date, day: Number(date.slice(8)), current: true };
  });
}
function MealSnapshotCard({
  label,
  meal,
  highlight = false,
}: {
  label: string;
  meal: MealSnapshot | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${highlight ? "border-[#0075de]/30 bg-[#e6f3fe]" : "border-black/[.08] bg-white"}`}
    >
      <p className="text-xs font-semibold text-black/40">{label}</p>
      {meal ? (
        <>
          <p className="mt-2 font-medium">주찬 · {meal.main}</p>
          {meal.sides.map((side) => (
            <p key={side} className="mt-1 text-sm text-black/60">
              부찬 · {side}
            </p>
          ))}
          {meal.baby && (
            <p className="mt-2 text-xs text-black/50">아기 · {meal.baby}</p>
          )}
          {meal.changeReason && (
            <p className="mt-2 text-xs text-[#075f9f]">
              이유 · {meal.changeReason}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-black/45">식단 정보 없음</p>
      )}
    </div>
  );
}
