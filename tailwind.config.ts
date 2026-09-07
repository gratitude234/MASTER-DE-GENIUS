import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // The product blue. Unchanged — this is already the canonical brand.
        brand: {
          50: "#EEF2FF",
          500: "#2F5AF0",
          600: "#2448D8",
          950: "#0F172A"
        },
        // Semantic scales are exact aliases of the Tailwind palettes the app
        // already uses (success = emerald, danger = red, warning = amber), so
        // naming them changes no pixel — it only gives the shades one name.
        success: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22"
        },
        danger: {
          50: "#fef2f2",
          100: "#fee2e2",
          200: "#fecaca",
          300: "#fca5a5",
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
          800: "#991b1b",
          900: "#7f1d1d",
          950: "#450a0a"
        },
        warning: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
          950: "#451a03"
        }
      },
      spacing: {
        // Single source of truth for the mobile tab bar. Backed by the custom
        // properties in app/globals.css so non-Tailwind CSS can read them too:
        //   bottom-nav-clearance  →  clears the tab bar + the home indicator
        //   h-nav-height          →  the tab bar itself
        "nav-height": "var(--nav-height)",
        "nav-clearance": "var(--nav-clearance)",
        "safe-bottom": "var(--safe-bottom)"
      },
      boxShadow: {
        soft: "0 10px 30px rgba(15, 23, 42, 0.06)"
      }
    }
  },
  plugins: [],
};

export default config;
