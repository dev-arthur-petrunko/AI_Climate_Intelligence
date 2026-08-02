"use client";

/**
 * Сторінка налаштувань — адреса сайту, версія та перелік поточного функціоналу.
 */

import { Globe, Info, Settings, CheckCircle2 } from "lucide-react";
import SideNavigation from "@/components/SideNavigation";
import MissionHeader from "@/components/MissionHeader";
import AIAssistant from "@/components/AIAssistant";
import { useI18n } from "@/lib/i18n";

export default function SettingsPage() {
  const { t } = useI18n();

  const siteUrl = "https://github.com/dev-arthur-petrunko/AI_Climate_Intelligence";

  return (
    <main className="min-h-screen bg-background">
      <SideNavigation />
      <MissionHeader />
      <div className="pt-24 px-6 pb-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gradient mb-2">{t.pages.settings.title}</h1>
            <p className="text-secondary">{t.pages.settings.subtitle}</p>
          </div>

          {/* Адреса сайту */}
          <div className="glass-strong p-6">
            <div className="flex items-center space-x-2 mb-4">
              <Globe className="w-5 h-5 text-emerald" />
              <h2 className="text-xl font-semibold">{t.settings.siteLabel}</h2>
            </div>
            <a
              href={siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 rounded-lg bg-surface-2 text-emerald hover:bg-surface-hover transition-all break-all"
            >
              {siteUrl}
            </a>
          </div>

          {/* Версія */}
          <div className="glass-strong p-6">
            <div className="flex items-center space-x-2 mb-4">
              <Info className="w-5 h-5 text-violet" />
              <h2 className="text-xl font-semibold">{t.settings.versionLabel}</h2>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-3xl font-bold text-gradient">{t.settings.version}</span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-emerald/10 text-emerald border border-emerald/20">
                stable
              </span>
            </div>
          </div>

          {/* Що вже є зараз */}
          <div className="glass-strong p-6">
            <div className="flex items-center space-x-2 mb-2">
              <Settings className="w-5 h-5 text-pink" />
              <h2 className="text-xl font-semibold">{t.settings.currentTitle}</h2>
            </div>
            <p className="text-secondary text-sm mb-4">{t.settings.currentText}</p>
            <ul className="space-y-3">
              {t.settings.items.map((item, index) => (
                <li key={index} className="flex items-start space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald mt-0.5 shrink-0" />
                  <span className="text-sm text-primary leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <AIAssistant />
    </main>
  );
}
