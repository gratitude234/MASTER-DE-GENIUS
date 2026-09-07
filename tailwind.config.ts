import type { Config } from "tailwindcss";

/**
 * The approved MASTER@DE'GENIUS visual system.
 *
 * Every token name predates this file — screens, primitives and tests all speak
 * in `slate-950`, `brand-500`, `rounded-2xl`. What changed is what those names
 * resolve to: the navy / light-neutral palette, the radii and the type of the
 * approved prototype (design-reference/master-de-genius-approved-prototype.html).
 * Re-pointing the scale re-skins every surface at once and keeps one place to
 * check a colour against the prototype.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Set on <html> by next/font in app/layout.tsx, so the fallback stack
        // and the `font-*` utilities can never disagree about which face wins.
        sans: ["var(--font-sans)", "IBM Plex Sans", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ["var(--font-serif)", "Source Serif 4", "Georgia", "ui-serif", "serif"],
        mono: ["var(--font-mono)", "IBM Plex Mono", "SFMono-Regular", "Consolas", "ui-monospace", "monospace"],
      },
      colors: {
        /*
         * The neutral ramp. Anchored on the prototype's three load-bearing
         * values — ink #0B1220, hairline #E4E7EC, page #F6F7FA — with the rest
         * interpolated so existing shade choices stay sensible.
         *
         * slate-400 is the prototype's own #8A93A3. slate-500 is a darkened
         * version of the same hue: the prototype uses #8A93A3 for 10–12px
         * captions, which is 2.9:1 on white, so caption text takes the darker
         * step and #8A93A3 stays for icons and decorative rules.
         */
        slate: {
          50: "#F6F7FA",
          100: "#F1F3F7",
          200: "#E4E7EC",
          300: "#CBD0DA",
          400: "#8A93A3",
          500: "#6B7383",
          600: "#5B6472",
          700: "#454D5E",
          800: "#33394A",
          900: "#1B2333",
          950: "#0B1220",
        },
        // The product accent. Navy rather than the previous royal blue.
        brand: {
          50: "#EEF2FC",
          100: "#DCE4F7",
          200: "#C9D5F2",
          300: "#9DB0E0",
          400: "#5B77BC",
          500: "#2A4494",
          600: "#223A80",
          700: "#1B2E68",
          800: "#152450",
          900: "#101B3B",
          950: "#0B1220",
        },
        // Correct / mastered / synced. 600 is the prototype's #1F7A4D.
        success: {
          50: "#E8F5EE",
          100: "#D7EDE0",
          200: "#BFE3CE",
          300: "#8FE0B4",
          400: "#4FB380",
          500: "#2C8F5C",
          600: "#1F7A4D",
          700: "#1B6B43",
          800: "#175838",
          900: "#12452C",
          950: "#0A2618",
        },
        // Incorrect / irreversible. 600 is the prototype's #B3261E.
        danger: {
          50: "#FBEAE9",
          100: "#F8DBD9",
          200: "#F3D0CE",
          300: "#E8A9A5",
          400: "#D4736C",
          500: "#C23B32",
          600: "#B3261E",
          700: "#9A2019",
          800: "#7A251F",
          900: "#5E1C17",
          950: "#3A100D",
        },
        // Flagged / offline / unanswered. 800 is the prototype's #7A5A0E.
        warning: {
          50: "#FFF6E5",
          100: "#FBF3E1",
          200: "#F0D9A6",
          300: "#E4C176",
          400: "#D4AB47",
          500: "#C89A2A",
          600: "#A8801A",
          700: "#8A6A1E",
          800: "#7A5A0E",
          900: "#5E4609",
          950: "#3A2B05",
        },
      },
      /*
       * The prototype's radii, applied to the whole scale rather than screen by
       * screen: controls 10px, cards 14px, heroes and sheets 18px. Keeping the
       * utility names means `rounded-2xl` still reads as "a card" everywhere.
       */
      borderRadius: {
        none: "0px",
        sm: "6px",
        DEFAULT: "8px",
        md: "8px",
        lg: "9px",
        xl: "10px",
        "2xl": "14px",
        "3xl": "18px",
        full: "9999px",
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
        // The prototype leans on hairlines, not elevation. `soft` stays for the
        // few surfaces that lift off the page, at prototype weight.
        soft: "0 10px 30px rgba(11, 18, 32, 0.06)"
      }
    }
  },
  plugins: [],
};

export default config;
