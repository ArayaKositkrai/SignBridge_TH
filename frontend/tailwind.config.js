/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#fbf6f1",
        sky: "#bbd6e1",
        brand: "#3885ab",
        navy: "#185079",
        royal: "#11329a",
        ink: "#3c3333",
        danger: { DEFAULT: "#d62839", dark: "#b01e2d" },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', '"Noto Sans Thai"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(60,51,51,.06), 0 8px 24px -12px rgba(24,80,121,.25)",
      },
      keyframes: {
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(214,40,57,.45)" },
          "100%": { boxShadow: "0 0 0 18px rgba(214,40,57,0)" },
        },
        fadeUp: {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        wave: {
          "0%, 100%": { transform: "scaleY(.25)" },
          "50%": { transform: "scaleY(1)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        scan: {
          "0%": { top: "0%", opacity: 0 },
          "10%, 90%": { opacity: 1 },
          "100%": { top: "100%", opacity: 0 },
        },
        ripple: {
          "0%": { transform: "scale(.8)", opacity: 0.6 },
          "100%": { transform: "scale(1.8)", opacity: 0 },
        },
        drift: {
          "0%, 100%": { transform: "translate(0,0) scale(1)" },
          "50%": { transform: "translate(24px,-18px) scale(1.08)" },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.8s ease-out infinite",
        fadeUp: "fadeUp .35s cubic-bezier(.2,.8,.2,1) both",
        wave: "wave .9s ease-in-out infinite",
        float: "float 3.2s ease-in-out infinite",
        scan: "scan 3.4s linear infinite",
        ripple: "ripple 2.4s ease-out infinite",
        drift: "drift 14s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
