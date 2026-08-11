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
        primary: "#E8EAF6",
        secondary: "#8B93B8",
        muted: "#4A5178",
        emerald: "#2EE6A6",
        violet: "#7C4DFF",
        pink: "#FF5C8A",
        amber: "#FFC24D",
        accent: {
          cyan: "#2EE6A6",
        },
      },
      boxShadow: {
        glow: "0 0 24px rgba(124,77,255,0.28), 0 8px 40px rgba(46,230,166,0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
