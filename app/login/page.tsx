"use client";

import { FormEvent, useState } from "react";
import { KeyRound, LoaderCircle, UtensilsCrossed } from "lucide-react";

export default function LoginPage() {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id.trim() || !password || loading) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "로그인에 실패했습니다.");
      const target = new URLSearchParams(window.location.search).get("next");
      window.location.assign(target?.startsWith("/") ? target : "/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인에 실패했습니다.");
    } finally { setLoading(false); }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f5f4] p-5">
      <section className="w-full max-w-md rounded-xl border border-black/[.08] bg-white p-6 sm:p-8">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#ffb110] text-[#5f4300]"><UtensilsCrossed size={22} /></div>
        <h1 className="mt-6 text-[30px] font-semibold tracking-[-.035em]">우리집 식탁</h1>
        <p className="mt-2 text-sm leading-6 text-black/60">가족 식단을 보려면 로그인해 주세요.</p>
        <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-4">
          <label className="block text-sm font-medium">ID<input autoFocus value={id} onChange={(event) => setId(event.target.value)} autoComplete="username" className="mt-2 h-11 w-full rounded-lg border border-black/[.12] px-3 text-base outline-none transition-colors focus:border-[#0075de] focus:ring-2 focus:ring-[#0075de]/20 sm:text-sm" /></label>
          <label className="block text-sm font-medium">비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="mt-2 h-11 w-full rounded-lg border border-black/[.12] px-3 text-base outline-none transition-colors focus:border-[#0075de] focus:ring-2 focus:ring-[#0075de]/20 sm:text-sm" /></label>
          {message && <p role="alert" className="text-sm text-[#b42318]">{message}</p>}
          <button type="submit" disabled={!id.trim() || !password || loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0075de] text-sm font-medium text-white transition-colors hover:bg-[#0067c4] disabled:cursor-not-allowed disabled:bg-black/20">{loading ? <LoaderCircle size={16} className="animate-spin" /> : <KeyRound size={16} />}로그인</button>
        </form>
        <p className="mt-5 text-center text-xs leading-5 text-black/45">이 기기에서는 최대 6개월 동안 로그인 상태가 유지됩니다.</p>
      </section>
    </main>
  );
}
