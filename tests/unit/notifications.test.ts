import {describe,expect,it} from 'vitest';
import {defaultNotifications,inQuietHours,normalizeNotifications} from '../../src/shared/notifications';

const at=(hours:number,minutes=0)=>new Date(2026,10,15,hours,minutes);

describe('通知设置',()=>{
  it('缺省开启提醒并规范化静默时段',()=>{
    expect(normalizeNotifications(undefined)).toEqual(defaultNotifications);
    expect(normalizeNotifications({enabled:false,dndEnabled:true,dndStart:'25:00',dndEnd:'08:00'})).toMatchObject({enabled:false,dndEnabled:true,dndStart:'22:00',dndEnd:'08:00'});
  });
  it('去重并限制静音账号',()=>{
    expect(normalizeNotifications({mutedAccountIds:['a','a','',42,'b']}).mutedAccountIds).toEqual(['a','b']);
  });
  it('跨午夜静默时段按本地时间判断',()=>{
    const settings={...defaultNotifications,dndEnabled:true,dndStart:'22:00',dndEnd:'08:00'};
    expect(inQuietHours(settings,at(23))).toBe(true);
    expect(inQuietHours(settings,at(7,59))).toBe(true);
    expect(inQuietHours(settings,at(8))).toBe(false);
    expect(inQuietHours(settings,at(12))).toBe(false);
  });
  it('同起止时间视为全天静默',()=>{
    const settings={...defaultNotifications,dndEnabled:true,dndStart:'09:00',dndEnd:'09:00'};
    expect(inQuietHours(settings,at(12))).toBe(true);
  });
});
