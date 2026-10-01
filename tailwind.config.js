/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#0c1411",
        slate: "#121c18",
        neon: "#5EF2A0",
        cyanGlow: "#7DD3FC",
        /* shadcn-compatible tokens (used by ui components) */
        background: "#050816",
        foreground: "#e8edf4",
        primary: "#22d3ee",
        "primary-foreground": "#041018",
        muted: "#64748b",
        "muted-foreground": "rgba(232, 237, 244, 0.55)",
        card: "#0c1220",
        "card-foreground": "#e8edf4",
        border: "rgba(255, 255, 255, 0.1)",
        input: "rgba(255, 255, 255, 0.12)",
        ring: "#22d3ee",
        secondary: "#1a2332",
        "secondary-foreground": "#e8edf4",
        destructive: "#dc2626",
        "destructive-foreground": "#fafafa",
        accent: "#1a2332",
        "accent-foreground": "#e8edf4",
      },
      borderRadius: {
        lg: "0.5rem",
        md: "calc(0.5rem - 2px)",
        sm: "calc(0.5rem - 4px)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
        neon: "0 0 24px rgba(0, 255, 153, 0.35)",
      },
      backdropBlur: {
        xs: "2px",
      },
      ringOffsetColor: {
        background: "#050816",
      },
    },
  },
  plugins: [],
};
