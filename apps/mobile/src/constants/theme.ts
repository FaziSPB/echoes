/** "Archival" palette: aged paper, ink and sepia, with a cold accent reserved for AI-generated content. */
export const Palette = {
  paper: '#F3EADB',
  paperDark: '#E4D6BF',
  ink: '#2B2118',
  inkSoft: '#6B5A48',
  sepia: '#8B5E34',
  sepiaLight: '#C49A6C',
  ai: '#3B8FE0',
  overlay: 'rgba(24, 18, 12, 0.72)',
  overlayLight: 'rgba(24, 18, 12, 0.45)',
  white: '#FFFFFF',
  danger: '#B3412E',
} as const;

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const Radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

export const Fonts = { serif: 'serif', mono: 'monospace' } as const;
