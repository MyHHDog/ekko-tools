export const appearanceFonts = ['comic', 'system', 'serif', 'mono'] as const;
export type AppearanceFont = typeof appearanceFonts[number];
export const appearanceSchemes = ['light', 'dark'] as const;
export type AppearanceScheme = typeof appearanceSchemes[number];
export const appearanceRegions = ['chrome', 'sidebar', 'content', 'card', 'input', 'overlay'] as const;
export type AppearanceRegion = typeof appearanceRegions[number];
export const appearanceBackgroundSizes = ['cover', 'contain', 'auto'] as const;
export type AppearanceBackgroundSize = typeof appearanceBackgroundSizes[number];
export const appearanceBackgroundPositions = ['center', 'top', 'bottom', 'left', 'right'] as const;
export type AppearanceBackgroundPosition = typeof appearanceBackgroundPositions[number];
export interface AppearanceSurface {
  backgroundColor?: string;
  opacity?: number;
  blur?: number;
  radius?: number;
  borderColor?: string;
  shadow?: number;
}
export interface AppearanceSettings {
  followStudio: boolean; colorScheme: AppearanceScheme; font: AppearanceFont;
  fontSize: number; lineHeight: number; radius: number; controlHeight: number;
  borderWidth: number; spacing: number; letterSpacing: number; shadow: number;
  contentWidth: number; accent: string; linkColor: string; pageColor: string;
  surfaceColor: string; textColor: string; secondaryTextColor: string;
  mutedTextColor: string; borderColor: string; opacity?: number;
  gradientColor?: string; gradientAngle: number; backgroundSize: AppearanceBackgroundSize;
  backgroundPosition: AppearanceBackgroundPosition; overlay: number; blur: number;
  backgroundName: string; backgroundMobileName: string;
  regions: Partial<Record<AppearanceRegion, AppearanceSurface>>;
}
export const appearancePalettes: Record<AppearanceScheme, {
  accent: string; linkColor: string; pageColor: string; surfaceColor: string;
  textColor: string; secondaryTextColor: string; mutedTextColor: string; borderColor: string;
}> = {
  light: {
    accent: '#333333', linkColor: '#333333', pageColor: '#fafafa', surfaceColor: '#ffffff',
    textColor: '#1a1a1a', secondaryTextColor: '#666666', mutedTextColor: '#999999', borderColor: '#e0e0e0'
  },
  dark: {
    accent: '#e0e0e0', linkColor: '#e0e0e0', pageColor: '#1a1a1a', surfaceColor: '#2a2a2a',
    textColor: '#e0e0e0', secondaryTextColor: '#a0a0a0', mutedTextColor: '#888888', borderColor: '#3a3a3a'
  }
};
export const appearanceRegionDefaults: Record<AppearanceRegion, {
  opacity: number; blur: number; radius: number; shadow: number;
}> = {
  chrome: {opacity: 0.6, blur: 8, radius: 8, shadow: 0},
  sidebar: {opacity: 0.78, blur: 8, radius: 0, shadow: 0},
  content: {opacity: 0.86, blur: 8, radius: 0, shadow: 0},
  card: {opacity: 0.72, blur: 8, radius: 8, shadow: 0},
  input: {opacity: 0.72, blur: 8, radius: 6, shadow: 0},
  overlay: {opacity: 0.72, blur: 8, radius: 8, shadow: 0}
};
export const appearanceDefaults: AppearanceSettings = {
  followStudio: true, colorScheme: 'light', font: 'system', fontSize: 14,
  lineHeight: 1.6, radius: 8, controlHeight: 36, borderWidth: 1, spacing: 1,
  letterSpacing: 0, shadow: 0, contentWidth: 960, ...appearancePalettes.light,
  gradientAngle: 135, backgroundSize: 'cover', backgroundPosition: 'center', overlay: 0, blur: 8,
  backgroundName: '', backgroundMobileName: '', regions: {}
};
function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number)) * 100) / 100 : fallback;
}
function optionalClamp(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number)) * 100) / 100 : undefined;
}
function color(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}
function optionalColor(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}
function surface(value: unknown): AppearanceSurface {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: AppearanceSurface = {};
  const backgroundColor = optionalColor(source.backgroundColor);
  const borderColor = optionalColor(source.borderColor);
  const opacity = optionalClamp(source.opacity, 0, 1);
  const blur = optionalClamp(source.blur, 0, 30);
  const radius = optionalClamp(source.radius, 0, 32);
  const shadow = optionalClamp(source.shadow, 0, 2);
  if (backgroundColor !== undefined) result.backgroundColor = backgroundColor;
  if (borderColor !== undefined) result.borderColor = borderColor;
  if (opacity !== undefined) result.opacity = opacity;
  if (blur !== undefined) result.blur = blur;
  if (radius !== undefined) result.radius = radius;
  if (shadow !== undefined) result.shadow = shadow;
  return result;
}
export function normalizeAppearance(value: unknown): AppearanceSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const font = appearanceFonts.includes(source.font as AppearanceFont) ? source.font as AppearanceFont : appearanceDefaults.font;
  const colorScheme = appearanceSchemes.includes(source.colorScheme as AppearanceScheme)
    ? source.colorScheme as AppearanceScheme : appearanceDefaults.colorScheme;
  const backgroundSize = appearanceBackgroundSizes.includes(source.backgroundSize as AppearanceBackgroundSize)
    ? source.backgroundSize as AppearanceBackgroundSize : appearanceDefaults.backgroundSize;
  const backgroundPosition = appearanceBackgroundPositions.includes(source.backgroundPosition as AppearanceBackgroundPosition)
    ? source.backgroundPosition as AppearanceBackgroundPosition : appearanceDefaults.backgroundPosition;
  const regions: Partial<Record<AppearanceRegion, AppearanceSurface>> = {};
  const rawRegions = source.regions && typeof source.regions === 'object'
    ? source.regions as Record<string, unknown> : {};
  for (const region of appearanceRegions) {
    const normalized = surface(rawRegions[region]);
    if (Object.keys(normalized).length) regions[region] = normalized;
  }
  const settings: AppearanceSettings = {
    followStudio: source.followStudio !== false,
    colorScheme,
    font,
    fontSize: clamp(source.fontSize, 12, 20, appearanceDefaults.fontSize),
    lineHeight: clamp(source.lineHeight, 1, 2.4, appearanceDefaults.lineHeight),
    radius: clamp(source.radius, 0, 32, appearanceDefaults.radius),
    controlHeight: clamp(source.controlHeight, 30, 56, appearanceDefaults.controlHeight),
    borderWidth: clamp(source.borderWidth, 1, 4, appearanceDefaults.borderWidth),
    spacing: clamp(source.spacing, 0.8, 1.6, appearanceDefaults.spacing),
    letterSpacing: clamp(source.letterSpacing, -1.5, 1.5, appearanceDefaults.letterSpacing),
    shadow: clamp(source.shadow, 0, 2, appearanceDefaults.shadow),
    contentWidth: clamp(source.contentWidth, 480, 1600, appearanceDefaults.contentWidth),
    accent: color(source.accent, appearanceDefaults.accent),
    linkColor: color(source.linkColor, appearanceDefaults.linkColor),
    pageColor: color(source.pageColor, appearanceDefaults.pageColor),
    surfaceColor: color(source.surfaceColor, appearanceDefaults.surfaceColor),
    textColor: color(source.textColor, appearanceDefaults.textColor),
    secondaryTextColor: color(source.secondaryTextColor, appearanceDefaults.secondaryTextColor),
    mutedTextColor: color(source.mutedTextColor, appearanceDefaults.mutedTextColor),
    borderColor: color(source.borderColor, appearanceDefaults.borderColor),
    gradientAngle: clamp(source.gradientAngle, 0, 360, appearanceDefaults.gradientAngle),
    backgroundSize,
    backgroundPosition,
    overlay: clamp(source.overlay, 0, 0.85, appearanceDefaults.overlay),
    blur: clamp(source.blur, 0, 24, appearanceDefaults.blur),
    backgroundName: typeof source.backgroundName === 'string' ? source.backgroundName.trim().slice(0, 120) : '',
    backgroundMobileName: typeof source.backgroundMobileName === 'string' ? source.backgroundMobileName.trim().slice(0, 120) : '',
    regions
  };
  const opacity = optionalClamp(source.opacity, 0, 1);
  const gradientColor = optionalColor(source.gradientColor);
  if (opacity !== undefined) settings.opacity = opacity;
  if (gradientColor !== undefined) settings.gradientColor = gradientColor;
  return settings;
}
