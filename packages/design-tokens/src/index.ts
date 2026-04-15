export const semanticColors = {
  background: "224 71% 4%",
  foreground: "210 40% 98%",
  card: "222 47% 11%",
  "card-foreground": "210 40% 98%",
  panel: "222 42% 13%",
  "panel-foreground": "210 40% 98%",
  primary: "191 95% 68%",
  "primary-foreground": "224 47% 10%",
  secondary: "217 33% 18%",
  "secondary-foreground": "210 40% 98%",
  muted: "216 16% 65%",
  "muted-foreground": "215 20% 76%",
  accent: "191 95% 68%",
  "accent-foreground": "224 47% 10%",
  success: "160 84% 39%",
  warning: "39 92% 55%",
  danger: "0 84% 60%",
  border: "217 33% 23%",
  input: "217 33% 23%",
  ring: "191 95% 68%",
} as const;

export const channelPalette = {
  production: "#EF4444",
  audio: "#3B82F6",
  videoCamera: "#10B981",
  lighting: "#F59E0B",
  stage: "#8B5CF6",
  utility: "#22D3EE",
} as const;

export const radii = {
  sm: "0.75rem",
  md: "0.9375rem",
  lg: "1.125rem",
  xl: "1.5rem",
  pill: "9999px",
} as const;

export const spacing = {
  compact: 8,
  base: 16,
  comfortable: 24,
  spacious: 32,
  touchTarget: 60,
} as const;

export const elevation = {
  panel: "0 24px 72px rgba(2, 6, 23, 0.55)",
  command: "0 20px 60px rgba(8, 145, 178, 0.18)",
} as const;

export const motion = {
  instant: "100ms",
  quick: "150ms",
  standard: "220ms",
  deliberate: "320ms",
} as const;

export const typography = {
  family:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  tracking: {
    tight: "-0.03em",
    wide: "0.14em",
  },
} as const;

export const designTokens = {
  semanticColors,
  channelPalette,
  radii,
  spacing,
  elevation,
  motion,
  typography,
} as const;

export type SemanticColorName = keyof typeof semanticColors;

export function getCssColorVariable(color: SemanticColorName): string {
  return `hsl(var(--${color}))`;
}
