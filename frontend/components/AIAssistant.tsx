"use client";

/**
 * AI-асистент — плаваючий віджет чату для кліматичних запитань.
 * Відповідає на запитання користувача про стан клімату.
 */

import { useState, useRef, useEffect } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function AIAssistant() {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: t.assistant.greeting,
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /** Автоматичний скрол до останнього повідомлення */
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  /** Відправка повідомлення користувача */
  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      role: "user",
      content: input,
      timestamp: new Date()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    /** Імітація відповіді AI (в майбутньому — реальний API) */
    setTimeout(() => {
      const responses = [
        "Based on current satellite data, global temperatures have increased by 1.54°C above pre-industrial levels. The Arctic region is warming at a rate 2-3 times faster than the global average.",
        "Wildfire risk is currently elevated in Southern Europe, Western North America, and parts of Australia due to prolonged drought conditions and above-average temperatures.",
        "Methane concentrations have reached 1928 ppb, the highest level in at least 800,000 years. This acceleration is concerning due to methane's potent greenhouse effect.",
        "Sea level rise is accelerating at 3.2 mm per year. Coastal regions in Southeast Asia and small island nations face the highest risk of flooding and erosion.",
        "The current El Niño pattern is expected to weaken over the coming months, transitioning to neutral conditions by mid-2026. This may temporarily moderate some extreme weather patterns."
      ];

      const randomResponse = responses[Math.floor(Math.random() * responses.length)];

      const assistantMessage: Message = {
        role: "assistant",
        content: randomResponse,
        timestamp: new Date()
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setIsTyping(false);
    }, 1500);
  };

  /** Обробка натискання Enter */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /** Кнопка відкриття чату (коли чат закритий) */
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 p-4 rounded-full bg-emerald text-[#04211A] shadow-lg hover:shadow-xl transition-all hover:scale-105 z-50"
      >
        <Sparkles className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 max-h-[600px] glass-strong shadow-2xl z-50 flex flex-col rounded-2xl overflow-hidden">
      {/* Заголовок чату */}
      <div className="p-4 border-b border-violet/15 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-5 h-5 text-emerald" />
          <h3 className="font-semibold">{t.assistant.title}</h3>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5 text-secondary" />
        </button>
      </div>

      {/* Список повідомлень */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.role === "user"
                  ? "bg-emerald text-[#04211A]"
                  : "bg-surface-2 text-primary"
              }`}
            >
              <p className="text-sm">{message.content}</p>
              <p className="text-xs opacity-60 mt-1">
                {message.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {/* Індикатор набору тексту */}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-surface-2 p-3 rounded-lg">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-emerald rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-emerald rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-emerald rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Поле введення */}
      <div className="p-4 border-t border-violet/15">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.assistant.placeholder}
            className="flex-1 bg-surface-2 border border-violet/15 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-violet transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="p-2 rounded-lg bg-emerald text-[#04211A] disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
