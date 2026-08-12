"use client";

/**
 * Сторінка підтримки проєкту — заклик підтримати Climate Intelligence.
 */

import { Heart, Star, Share2, Bug, Code2, HandHeart, ExternalLink, CreditCard, Coins, MessageSquare, Github } from "lucide-react";
import SideNavigation from "@/components/SideNavigation";
import MissionHeader from "@/components/MissionHeader";
import { useI18n } from "@/lib/i18n";

const REPO_URL = "https://github.com/dev-arthur-petrunko/AI_Climate_Intelligence";
const SITE_URL = "https://aiclimateintelligence.vercel.app";
const TELEGRAM_URL = "https://t.me/Arthur_Petrunko";

const SUPPORT_ACTIONS = [
  {
    icon: Github,
    actionKey: "star",
    href: REPO_URL,
    external: true,
  },
  {
    icon: Share2,
    actionKey: "share",
    href: SITE_URL,
    external: true,
  },
  {
    icon: MessageSquare,
    actionKey: "report",
    href: TELEGRAM_URL,
    external: true,
  },
  {
    icon: Code2,
    actionKey: "contribute",
    href: REPO_URL,
    external: true,
  },
];

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
            {SUPPORT_ACTIONS.map((action) => (
              <a
                key={action.actionKey}
                href={action.href}
                target="_blank"
                rel="noreferrer"
                className="glass p-6 flex items-start space-x-4 hover:shadow-glow hover:-translate-y-1 transition-all duration-300"
              >
                <div className="p-3 rounded-lg bg-violet/12 text-violet shrink-0">
                  <action.icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-primary leading-relaxed">{t.support.actions[action.actionKey as keyof typeof t.support.actions].title}</p>
                  <p className="text-xs text-secondary mt-1">{t.support.actions[action.actionKey as keyof typeof t.support.actions].desc}</p>
                  <span className="inline-flex items-center gap-1 mt-2 text-xs text-cyan">
                    {action.href === REPO_URL ? t.common.github : action.href === SITE_URL ? t.common.site : t.common.telegram}
                    <ExternalLink className="w-3 h-3" />
                  </span>
                </div>
              </a>
            ))}
          </div>

          {/* Донати */}
          <div className="glass-strong p-8">
            <div className="flex items-center space-x-3 mb-6">
              <Coins className="w-6 h-6 text-pink" />
              <h2 className="text-2xl font-bold text-gradient">{t.support.donate.heading}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <a
                href="https://ko-fi.com/arthurpetrunko"
                target="_blank"
                rel="noreferrer"
                className="glass p-5 flex items-center justify-between hover:shadow-glow hover:-translate-y-1 transition-all duration-300"
              >
                <span className="text-sm text-primary leading-relaxed">
                  🔗 {t.support.donate.koFi}
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
                  🔗 {t.support.donate.banka}
                  <span className="block text-secondary">send.monobank.ua/jar/3wbcqxkvAv</span>
                </span>
                <ExternalLink className="w-5 h-5 text-secondary shrink-0" />
              </a>
            </div>

            <div className="glass p-5 mb-6 flex flex-wrap items-center gap-4">
              <div className="flex items-center space-x-3">
                <Coins className="w-5 h-5 text-warning" />
                <div>
                  <div className="text-xs text-secondary">{t.support.donate.goal}</div>
                  <div className="text-sm text-primary">{t.support.donate.goalValue}</div>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <CreditCard className="w-5 h-5 text-accent-blue" />
                <div>
                  <div className="text-xs text-secondary">{t.support.donate.card}</div>
                  <div className="text-sm text-primary font-mono">{t.support.donate.cardNumber}</div>
                </div>
              </div>
            </div>

            <div className="space-y-4 text-sm text-secondary leading-relaxed">
              <p>{t.support.donate.p1}</p>
              <p>{t.support.donate.p2}</p>
              <p>{t.support.donate.p3}</p>
              <p className="text-primary font-medium">{t.support.donate.p4}</p>
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
