"use client";

import { useState } from "react";
import { Sparkles, Menu, X, BookOpen, Settings } from "lucide-react";
import Link from "next/link";

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="mx-4 mt-4">
        <nav
          className="glass-card max-w-6xl mx-auto px-5 py-3 rounded-2xl flex items-center justify-between"
          role="navigation"
          aria-label="메인 내비게이션"
        >
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 cursor-pointer" aria-label="홈으로">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            <div>
              <span className="font-bold text-base text-slate-900 leading-none">CS쉐어링</span>
              <span className="block text-[10px] text-slate-400 leading-none mt-0.5">AI 마케팅 자동화</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            <Link
              href="/"
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-200 cursor-pointer"
            >
              콘텐츠 생성
            </Link>
            <Link
              href="/guides"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-200 cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              가이드 관리
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-200 cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" aria-hidden="true" />
              API 설정
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-200 cursor-pointer"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <X className="w-5 h-5" aria-hidden="true" />
            ) : (
              <Menu className="w-5 h-5" aria-hidden="true" />
            )}
          </button>
        </nav>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="glass-card max-w-6xl mx-auto mt-2 px-5 py-4 rounded-2xl md:hidden fade-in">
            <div className="flex flex-col gap-1">
              <Link
                href="/"
                className="px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-200 cursor-pointer"
                onClick={() => setMobileOpen(false)}
              >
                콘텐츠 생성
              </Link>
              <Link
                href="/guides"
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-200 cursor-pointer"
                onClick={() => setMobileOpen(false)}
              >
                <BookOpen className="w-4 h-4" aria-hidden="true" />
                가이드 관리
              </Link>
              <Link
                href="/settings"
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors duration-200 cursor-pointer"
                onClick={() => setMobileOpen(false)}
              >
                <Settings className="w-4 h-4" aria-hidden="true" />
                API 설정
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
