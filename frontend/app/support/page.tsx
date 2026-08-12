"use client";

/**
 * Сторінка підтримки проєкту — заклик підтримати Climate Intelligence.
 */

import { Heart, Star, Share2, Bug, Code2, HandHeart, ExternalLink, CreditCard, Coins } from "lucide-react";
import SideNavigation from "@/components/SideNavigation";
import MissionHeader from "@/components/MissionHeader";
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

          {/* Донати */}
          <div className="glass-strong p-8">
            <div className="flex items-center space-x-3 mb-6">
              <Coins className="w-6 h-6 text-pink" />
              <h2 className="text-2xl font-bold text-gradient">
                Ваша поддержка очень важна для развития проекта!
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <a
                href="https://ko-fi.com/arthurpetrunko"
                target="_blank"
                rel="noreferrer"
                className="glass p-5 flex items-center justify-between hover:shadow-glow hover:-translate-y-1 transition-all duration-300"
              >
                <span className="text-sm text-primary leading-relaxed">
                  🔗 Ko-fi:
                  <span className="block text-secondary">ko-fi.com/arthurpetrunko</span>
                </span>
                <ExternalLink className="w-5 h-5 text-secondary shrink-0" />
              </a>
              <a
                href="https://send.monobank.ua/jar/3wbcqxkvAv"
                target="_blank"
                rel="noreferrer"
                className="glass p-5 flex items-center justify-between hover:shadow-glow hover:-translate-y-1 transition-all duration-300"
              >
                <span className="text-sm text-primary leading-relaxed">
                  🔗 Ссылка на банку (Монобанк):
                  <span className="block text-secondary">send.monobank.ua/jar/3wbcqxkvAv</span>
                </span>
                <ExternalLink className="w-5 h-5 text-secondary shrink-0" />
              </a>
            </div>

            <div className="glass p-5 mb-6 flex flex-wrap items-center gap-4">
              <div className="flex items-center space-x-3">
                <Coins className="w-5 h-5 text-warning" />
                <div>
                  <div className="text-xs text-secondary">AI Climate 🌍</div>
                  <div className="text-sm text-primary">🎯 Цель: 105 000.00 ₴</div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <CreditCard className="w-5 h-5 text-accent-blue" />
                <div>
                  <div className="text-xs text-secondary">💳 Номер карты Монобанк</div>
                  <div className="text-sm text-primary font-mono">4874 1000 3074 7904</div>
                </div>
              </div>
            </div>

            <div className="space-y-4 text-sm text-secondary leading-relaxed">
              <p>
                Сейчас я развиваю 3 проекта, и для каждого из них создаю собственного
                AI-анализатора, который будет давать реальные, объективные ответы. Все проекты
                будут полностью бесплатными для пользователей, оборудование так же будет
                изолировано между проектами.
              </p>
              <p>
                На данный момент проекты находятся в бета-версии — я жду возможности приобрести
                необходимое железо для обучения AI, поэтому эти сборы критически важны. Указанная
                сумма — это тот минимум, который нужен для покупки б/у оборудования. Понимаю, что
                это не идеальный вариант, но для старта этого хватит!
              </p>
              <p>
                Этот проект важен для всего человечества: он поможет лучше понять, что происходит
                с Землёй, и даст людям доступ к честной, проверенной информации об этом.
              </p>
              <p className="text-primary font-medium">
                Каждый донат приближает нас к запуску полноценной версии — спасибо за вашу
                поддержку! 🙏
              </p>
            </div>
          </div>

          {/* Подяка */}
          <div className="glass-strong p-6 flex items-center space-x-4">
            <HandHeart className="w-6 h-6 text-emerald shrink-0" />
            <p className="text-sm text-secondary leading-relaxed">{t.support.thanks}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
