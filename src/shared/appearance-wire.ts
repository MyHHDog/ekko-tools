import {appearanceBackgroundPositions, appearanceBackgroundSizes, appearanceFonts, appearanceRegions,
  appearanceSchemes, normalizeAppearance} from './appearance';
import type {AppearanceSettings} from './appearance';

const globalEnums = {
  colorScheme: appearanceSchemes, font: appearanceFonts,
  backgroundSize: appearanceBackgroundSizes, backgroundPosition: appearanceBackgroundPositions
};
const globalChoices = Object.keys(globalEnums) as (keyof typeof globalEnums)[];
const globalNumbers = ['fontSize', 'lineHeight', 'radius', 'controlHeight', 'borderWidth', 'spacing',
  'letterSpacing', 'shadow', 'contentWidth', 'gradientAngle', 'overlay', 'blur', 'opacity'] as const;
const globalColors = ['accent', 'linkColor', 'pageColor', 'surfaceColor', 'textColor', 'secondaryTextColor',
  'mutedTextColor', 'borderColor', 'gradientColor'] as const;
const regionNumbers = ['opacity', 'blur', 'radius', 'shadow'] as const;
const regionColors = ['backgroundColor', 'borderColor'] as const;
const separator = '!';
const encodeNumber = (value?: number) => value === undefined ? '' : Math.round(value * 100).toString(36);
const encodeColor = (value?: string) => value === undefined ? '' :
  btoa(String.fromCharCode(...value.slice(1).match(/../g)!.map(pair => parseInt(pair, 16))))
    .replace(/\+/g, '-').replace(/\//g, '_');
const decodeColor = (field: string) => field === '' ? undefined : '#' +
  Array.from(atob(field.replace(/-/g, '+').replace(/_/g, '/')), digit => digit.charCodeAt(0).toString(16).padStart(2, '0')).join('');

export function encodeAppearanceSave(value: AppearanceSettings): string {
  const settings = normalizeAppearance(value);
  return ['1', settings.followStudio ? '1' : '0',
    ...globalChoices.map(key => (globalEnums[key] as readonly string[]).indexOf(settings[key])),
    ...globalNumbers.map(key => encodeNumber(settings[key])), ...globalColors.map(key => encodeColor(settings[key])),
    ...appearanceRegions.flatMap(region => {
      const surface = settings.regions[region];
      return [...regionNumbers.map(key => encodeNumber(surface?.[key])), ...regionColors.map(key => encodeColor(surface?.[key]))];
    })].join(separator);
}

export function decodeAppearanceSave(wire: string): AppearanceSettings {
  const [version, ...fields] = wire.split(separator);
  const globalCount = 1 + globalChoices.length + globalNumbers.length + globalColors.length;
  const surfaceCount = regionNumbers.length + regionColors.length;
  if (version !== '1' || fields.length !== globalCount + appearanceRegions.length * surfaceCount) {
    throw new Error('Invalid appearance format');
  }
  let offset = 1;
  const values = (keys: readonly string[], read: (field: string) => unknown) => Object.fromEntries(
    keys.map(key => [key, read(fields[offset++])])
  );
  const numbers = (keys: readonly string[]) => values(keys, field => field === '' ? undefined : parseInt(field, 36) / 100);
  const colors = (keys: readonly string[]) => values(keys, decodeColor);
  const settings = normalizeAppearance({
    followStudio: fields[0] === '1',
    ...Object.fromEntries(globalChoices.map(key => [key, globalEnums[key][Number(fields[offset++])]])),
    ...numbers(globalNumbers), ...colors(globalColors),
    regions: Object.fromEntries(appearanceRegions.map(region => [region, {...numbers(regionNumbers), ...colors(regionColors)}]))
  });
  if (encodeAppearanceSave(settings) !== wire) throw new Error('Invalid appearance values');
  return settings;
}
