export const appearanceFonts = ['comic','system','serif','mono'] as const;
export type AppearanceFont = typeof appearanceFonts[number];
export interface AppearanceSettings {
  followStudio:boolean; font:AppearanceFont; fontSize:number; radius:number;
  controlHeight:number; borderWidth:number; spacing:number; letterSpacing:number;
  accent:string; overlay:number; blur:number; backgroundName:string;
}
export const appearanceDefaults:AppearanceSettings = {
  followStudio:true, font:'comic', fontSize:14, radius:23, controlHeight:41,
  borderWidth:2.5, spacing:1.1, letterSpacing:-0.6, accent:'#4266a7',
  overlay:0, blur:0, backgroundName:''
};
const clamp=(value:unknown,min:number,max:number,fallback:number)=>{
  const number=Number(value);
  return Number.isFinite(number)?Math.round(Math.min(max,Math.max(min,number))*100)/100:fallback;
};
export function normalizeAppearance(value:unknown):AppearanceSettings {
  const source=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const font=appearanceFonts.includes(source.font as AppearanceFont)?source.font as AppearanceFont:appearanceDefaults.font;
  const accent=typeof source.accent==='string'&&/^#[0-9a-f]{6}$/i.test(source.accent)?source.accent.toLowerCase():appearanceDefaults.accent;
  return {
    followStudio:source.followStudio!==false,
    font,
    fontSize:clamp(source.fontSize,12,20,appearanceDefaults.fontSize),
    radius:clamp(source.radius,0,32,appearanceDefaults.radius),
    controlHeight:clamp(source.controlHeight,30,56,appearanceDefaults.controlHeight),
    borderWidth:clamp(source.borderWidth,1,4,appearanceDefaults.borderWidth),
    spacing:clamp(source.spacing,0.8,1.6,appearanceDefaults.spacing),
    letterSpacing:clamp(source.letterSpacing,-1.5,1.5,appearanceDefaults.letterSpacing),
    accent,
    overlay:clamp(source.overlay,0,0.85,appearanceDefaults.overlay),
    blur:clamp(source.blur,0,24,appearanceDefaults.blur),
    backgroundName:typeof source.backgroundName==='string'?source.backgroundName.trim().slice(0,120):''
  };
}
