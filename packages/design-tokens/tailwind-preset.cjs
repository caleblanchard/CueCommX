/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        background: "hsl(224 71% 4%)",
        foreground: "hsl(210 40% 98%)",
        card: "hsl(222 47% 11%)",
        "card-foreground": "hsl(210 40% 98%)",
        panel: "hsl(222 42% 13%)",
        "panel-foreground": "hsl(210 40% 98%)",
        primary: "hsl(191 95% 68%)",
        "primary-foreground": "hsl(224 47% 10%)",
        secondary: "hsl(217 33% 18%)",
        "secondary-foreground": "hsl(210 40% 98%)",
        muted: "hsl(216 16% 65%)",
        "muted-foreground": "hsl(215 20% 76%)",
        accent: "hsl(191 95% 68%)",
        "accent-foreground": "hsl(224 47% 10%)",
        success: "hsl(160 84% 39%)",
        warning: "hsl(39 92% 55%)",
        danger: "hsl(0 84% 60%)",
        border: "hsl(217 33% 23%)",
        input: "hsl(217 33% 23%)",
        ring: "hsl(191 95% 68%)",
      },
      borderRadius: {
        sm: "0.75rem",
        md: "0.9375rem",
        lg: "1.125rem",
        xl: "1.5rem",
      },
      boxShadow: {
        panel: "0 24px 72px rgba(2, 6, 23, 0.55)",
        command: "0 20px 60px rgba(8, 145, 178, 0.18)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
      },
      minHeight: {
        touch: "60px",
      },
      minWidth: {
        touch: "60px",
      },
      spacing: {
        18: "4.5rem",
      },
      letterSpacing: {
        control: "0.14em",
      },
    },
  },
};
