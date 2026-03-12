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
        "brand-primary": "#B3838C",   // PANTONE 695 C — botões ativos, header, foco de inputs
        "brand-secondary": "#C5949D", // PANTONE 694 C — hover, degradê login
        "brand-dark": "#585858",      // Cinza escuro — sidebar, títulos
        "brand-light": "#FFFFFF",     // Branco
        "brand-black": "#1D1D1D",     // Preto — logo Grupo Cairo Benevides
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
        primary: ["var(--font-inter)", "Inter", "sans-serif"],
        secondary: ["var(--font-lato)", "Lato", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
