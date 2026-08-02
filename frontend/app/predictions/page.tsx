"use client";

/**
 * Сторінка прогнозів — AI-прогнози кліматичних загроз.
 * Відображає ймовірності та рівні ризику.
 */

import SideNavigation from "@/components/SideNavigation";
import MissionHeader from "@/components/MissionHeader";
import AIPredictions from "@/components/AIPredictions";
import { useI18n } from "@/lib/i18n";

export default function Predictions() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen bg-background">
      <SideNavigation />
      <MissionHeader />
      <div className="pt-24 px-6 pb-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gradient mb-2">{t.pages.predictions.title}</h1>
            <p className="text-secondary">{t.pages.predictions.subtitle}</p>
          </div>
          <AIPredictions />
        </div>
      </div>
    </main>
  );
}
