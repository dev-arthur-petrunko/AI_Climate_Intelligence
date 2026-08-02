"use client";

/**
 * Сторінка аналітики — інтерактивні графіки кліматичних даних.
 * Використовує Plotly для візуалізації.
 */

import { Suspense } from "react";
import SideNavigation from "@/components/SideNavigation";
import MissionHeader from "@/components/MissionHeader";
import AnalyticsCharts from "@/components/AnalyticsCharts";
import AIAssistant from "@/components/AIAssistant";
import { useI18n } from "@/lib/i18n";

export default function Analytics() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen bg-background">
      <SideNavigation />
      <MissionHeader />
      <div className="pt-24 px-6 pb-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gradient mb-2">{t.pages.analytics.title}</h1>
            <p className="text-secondary">{t.pages.analytics.subtitle}</p>
          </div>
          <Suspense fallback={<div className="glass p-8">{t.common.loading}</div>}>
            <AnalyticsCharts />
          </Suspense>
        </div>
      </div>
      <AIAssistant />
    </main>
  );
}
