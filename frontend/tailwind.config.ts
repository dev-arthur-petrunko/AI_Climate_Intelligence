import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#070A16",
        surface: "#0D1226",
        "surface-2": "#121A38",
        "surface-hover": "#16204A",
        border: "rgba(124,77,255,0.14)",
        "border-strong": "rgba(46,230,166,0.35)",
        primary: "#E8EAF6",
        secondary: "#8B93B8",
        muted: "#4A5178",
        emerald: "#2EE6A6",
        violet: "#7C4DFF",
        pink: "#FF5C8A",
        amber: "#FFC24D",
        accent: {
          blue: "#7C4DFF",
          cyan: "#2EE6A6",
        },
        success: "#2EE6A6",
        warning: "#FFC24D",
        danger: "#FF5C8A",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      boxShadow: {
        glow: "0 0 24px rgba(124,77,255,0.28), 0 8px 40px rgba(46,230,166,0.08)",
      },
      animation: {
        "glow": "glow 3s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        glow: {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-20px)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
