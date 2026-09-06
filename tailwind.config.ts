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
        brand: {
          50: "#EEF2FF",
          500: "#2F5AF0",
          600: "#2448D8",
          950: "#0F172A"
        }
      },
      boxShadow: {
        soft: "0 10px 30px rgba(15, 23, 42, 0.06)"
      }
    }
  },
  plugins: [],
};

export default config;
