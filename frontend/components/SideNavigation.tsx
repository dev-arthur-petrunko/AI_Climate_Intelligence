"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Globe, Sparkles, Layers, Menu } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import LanguageSwitcher from "./LanguageSwitcher";

/**
 * Бокове меню навігації — випливає зліва.
 * Містить посилання на сторінки та перемикач мови.
 */
export default function SideNavigation() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  /** Елементи навігації */
  const navItems = [
    { id: "globe", label: t.nav.globe, icon: Globe, path: "/" },
    { id: "analytics", label: t.nav.analytics, icon: Layers, path: "/analytics" },
    { id: "predictions", label: t.nav.predictions, icon: Sparkles, path: "/predictions" },
  ];

  return (
    <>
      {/* Кнопка-гамбургер для відкриття меню */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed left-4 top-4 z-50 w-10 h-10 flex items-center justify-center glass rounded-xl hover:bg-white/10 transition-all"
        aria-label="Toggle navigation"
      >
        <Menu className="w-4 h-4 text-primary" />
      </button>

      {/* Затемнений фон при відкритому меню */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Саме меню — випливає зліва з анімацією */}
      <div
        className="fixed left-0 top-0 h-full w-56 glass-strong z-50 transition-all"
        style={{
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 300ms cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="p-5 space-y-1.5">
          {/* Бренд — назва проєкту */}
          <div className="mb-6 mt-1">
            <div className="text-xs font-bold uppercase tracking-[0.15em] leading-tight">
              <span className="text-primary">AI Climate </span>
              <span className="text-emerald">Intelligence</span>
            </div>
            <div className="text-[8px] uppercase tracking-[0.3em] text-muted mt-1.5">
              Petrunko Arthur
            </div>
          </div>

          {/* Посилання на сторінки */}
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.path;
            return (
              <button
                key={item.id}
                onClick={() => {
                  router.push(item.path);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? "bg-emerald text-[#04211A] font-semibold"
                    : "hover:bg-white/10 text-primary"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          {/* Розділювач */}
          <div className="pt-4 border-t border-violet/15">
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </>
  );
}
