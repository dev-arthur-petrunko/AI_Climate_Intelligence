"use client";

/**
 * Перемикач мови — випадаючий список з 7 мовами.
 * Зберігає вибір у localStorage.
 */

import { useState, useRef, useEffect } from "react";
import { Languages } from "lucide-react";
import { useI18n, LOCALES } from "@/lib/i18n";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LOCALES.find((l) => l.code === locale)!;

  /** Закриття списку при кліку поза межами */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      {/* Кнопка поточної мови */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg glass hover:bg-white/10 transition-all"
        aria-label="Language"
      >
        <Languages className="w-3.5 h-3.5 text-secondary" />
        <span className="text-xs text-primary">{current.flag}</span>
        <span className="text-[10px] uppercase tracking-wider text-secondary">
          {current.code}
        </span>
      </button>

      {/* Випадаючий список мов */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-44 glass-strong rounded-xl py-1.5 z-50 shadow-2xl">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLocale(l.code);
                setIsOpen(false);
              }}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 text-left transition-colors ${
                l.code === locale ? "text-emerald" : "text-secondary hover:text-primary"
              }`}
            >
              <span className="text-sm">{l.flag}</span>
              <span className="flex-1 text-xs">{l.native}</span>
              {l.code === locale && <span className="text-emerald text-xs">●</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
