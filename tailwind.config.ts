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
        bg: "var(--bg)",
        "surface-1": "var(--surface-1)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          bg: "var(--accent-bg)",
          border: "var(--accent-border)",
          text: "var(--accent-text)",
        },
        success: {
          DEFAULT: "var(--success)",
          bg: "var(--success-bg)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          bg: "var(--warning-bg)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          bg: "var(--danger-bg)",
        },
        status: {
          active: "var(--status-active)",
          monitoring: "var(--status-monitoring)",
          archived: "var(--status-archived)",
        },
        // Scroll-driven cinematic surfaces ONLY (see app/globals.css's own
        // --cinema-* token comment) — every existing screen keeps using
        // `accent` (indigo) above, untouched.
        cinema: {
          gold: "var(--cinema-gold)",
          "gold-hover": "var(--cinema-gold-hover)",
          "gold-text": "var(--cinema-gold-text)",
          red: "var(--cinema-red)",
        },
      },
      fontFamily: {
        // 4-role brand system — see app/globals.css's own header comment on
        // these tokens. `sans` is a back-compat alias (resolves to the same
        // var as `ui`) so existing `font-sans` usages pick up Montserrat
        // automatically; prefer `font-ui` in new code.
        sans: ["var(--font-sans)", "Montserrat", "sans-serif"],
        ui: ["var(--font-ui)", "Montserrat", "sans-serif"],
        display: ["var(--font-display)", "Jost", "sans-serif"],
        "body-doc": ["var(--font-body-doc)", "Roboto", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      }
    },
  },
  plugins: [],
};
export default config;
