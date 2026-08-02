"use client";

/**
 * Сторінка підтримки проєкту — заклик підтримати Climate Intelligence.
 */

import { Heart, Star, Share2, Bug, Code2, HandHeart } from "lucide-react";
import SideNavigation from "@/components/SideNavigation";
import MissionHeader from "@/components/MissionHeader";
import AIAssistant from "@/components/AIAssistant";
import { useI18n } from "@/lib/i18n";

const ICONS = [Star, Share2, Bug, Code2];

export default function SupportPage() {
  const { t } = useI18n();

  return (
    <main className="min-h-screen bg-background">
      <SideNavigation />
      <MissionHeader />
      <div className="pt-24 px-6 pb-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gradient mb-2">{t.pages.support.title}</h1>
            <p className="text-secondary">{t.pages.support.subtitle}</p>
          </div>

          {/* Запрошення до підтримки */}
          <div className="glass-strong p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-pink/10 border border-pink/20 flex items-center justify-center">
              <Heart className="w-8 h-8 text-pink animate-pulse" />
            </div>
            <h2 className="text-2xl font-bold text-gradient mb-4">{t.support.heading}</h2>
            <p className="text-secondary leading-relaxed max-w-2xl mx-auto">{t.support.text}</p>
          </div>

          {/* Способи підтримки */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {t.support.items.map((item, index) => {
              const Icon = ICONS[index % ICONS.length];
              return (
                <div
                  key={index}
                  className="glass p-6 flex items-start space-x-4 hover:shadow-glow hover:-translate-y-1 transition-all duration-300"
                >
                  <div className="p-3 rounded-lg bg-violet/12 text-violet shrink-0">
                    <Icon className="w-5 h-5" />
                  </div>
                  <p className="text-sm text-primary leading-relaxed">{item}</p>
                </div>
              );
            })}
          </div>

          {/* Подяка */}
          <div className="glass-strong p-6 flex items-center space-x-4">
            <HandHeart className="w-6 h-6 text-emerald shrink-0" />
            <p className="text-sm text-secondary leading-relaxed">{t.support.thanks}</p>
          </div>
        </div>
      </div>
      <AIAssistant />
    </main>
  );
}
