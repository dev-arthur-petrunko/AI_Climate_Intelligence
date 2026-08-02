"use client";

/**
 * Головна сторінка:
 * 1. Секція глобуса — на весь екран (100vh), видима зразу.
 * 2. Дашборд — нижче, з'являється при прокрутці вниз.
 */

import { Suspense } from "react";
import SideNavigation from "@/components/SideNavigation";
import EarthGlobe from "@/components/EarthGlobe";
import MissionHeader from "@/components/MissionHeader";
import { KPICards, LiveEventFeed, AIClimateSummary } from "@/components/DashboardSections";
import AIAssistant from "@/components/AIAssistant";
import { useI18n } from "@/lib/i18n";

export default function Home() {
  const { t } = useI18n();
  return (
    <main className="bg-background min-h-screen">
      {/* Секція 1: Глобус на весь екран — видимий зразу */}
      <section className="h-screen w-full relative">
        <Suspense fallback={<div className="w-full h-full bg-[#070A16]" />}>
          <EarthGlobe />
        </Suspense>

        {/* Плавний градієнтний перехід до дашборду */}
        <div className="absolute bottom-0 left-0 right-0 h-56 bg-gradient-to-b from-transparent via-background/30 to-background pointer-events-none z-10" />
      </section>

      {/* Секція 2: Дашборд — з'являється при прокрутці вниз */}
      <section id="climate-dashboard" className="relative -mt-1 bg-background px-6 pt-8 pb-12">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gradient mb-2">{t.dashboard.sectionTitle}</h2>
            <p className="text-secondary">{t.dashboard.sectionSubtitle}</p>
          </div>
          <KPICards />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-10">
            <AIClimateSummary />
            <LiveEventFeed />
          </div>
        </div>
      </section>

      {/* Бокове меню навігації */}
      <SideNavigation />

      {/* Верхній бар зі статистикою */}
      <MissionHeader />

      {/* AI-асистент */}
      <AIAssistant />
    </main>
  );
}
