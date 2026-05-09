/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#eef4ff",
          100: "#dae6ff",
          200: "#bdd1ff",
          300: "#8fb1ff",
          400: "#5d87ff",
          500: "#3a62fb",
          600: "#2546ec",
          700: "#1f37c4",
          800: "#1f329c",
          900: "#1f2f7a",
          950: "#161e4d"
        }
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif"
        ]
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.06)"
      }
    }
  },
  plugins: []
};
