import {afterEach,describe,expect,it} from 'vitest';
import {appearanceDefaults,normalizeAppearance} from '../../src/server/appearance';
import {appearanceRegions} from '../../src/shared/appearance';
import {decodeAppearanceSave,encodeAppearanceSave} from '../../src/shared/appearance-wire';
import {harness,unwrap} from '../helpers';
import {memoryStorage} from '../harness-host';
import type {Storage} from '../../src/server/adapter/host';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
const open:Awaited<ReturnType<typeof harness>>[]=[];
afterEach(async()=>{for(const h of open.splice(0))await h.close();});
const jpeg=Buffer.from([0xff,0xd8,0xff,0xdb,0,1,2,3,4,5]);
describe('插件外观设置',()=>{
  it('缺省跟随 Studio，数值和颜色均被规范化',()=>{
    expect(normalizeAppearance(undefined)).toEqual(appearanceDefaults);
    expect('opacity' in normalizeAppearance(undefined)).toBe(false);
    expect('gradientColor' in normalizeAppearance(undefined)).toBe(false);
    expect(appearanceDefaults).toMatchObject({
      followStudio:true,font:'system',radius:8,controlHeight:36,borderWidth:1,
      spacing:1,letterSpacing:0,accent:'#333333',overlay:0,blur:8
    });
    expect(normalizeAppearance({fontSize:99,radius:-5,spacing:0,overlay:2,blur:-1,accent:'red'})).toMatchObject({
      fontSize:20,radius:0,spacing:0.8,overlay:0.85,blur:0,accent:appearanceDefaults.accent
    });
  });
  it('保留 Studio 精细外观字段，并按区域清理无效覆盖',()=>{
    const settings=normalizeAppearance({
      followStudio:false,colorScheme:'dark',lineHeight:1.9,shadow:1.2,contentWidth:1280,
      linkColor:'#FF0000',pageColor:'#101010',surfaceColor:'#202020',textColor:'#E0E0E0',
      secondaryTextColor:'#AAAAAA',mutedTextColor:'#777777',borderColor:'#333333',accent:'#00AA88',
      opacity:0.03,gradientColor:'#123456',gradientAngle:155,backgroundSize:'contain',
      backgroundPosition:'top',backgroundName:'wall.jpg',
      regions:{
        content:{opacity:0.5,blur:12,radius:20,backgroundColor:'#111111',borderColor:'#222222',shadow:1},
        sidebar:{opacity:9,blur:-3,bogus:1 as unknown as number},
        unknown:{opacity:0.4}
      }
    });
    expect(settings).toMatchObject({
      followStudio:false,colorScheme:'dark',lineHeight:1.9,shadow:1.2,contentWidth:1280,
      linkColor:'#ff0000',pageColor:'#101010',surfaceColor:'#202020',textColor:'#e0e0e0',
      secondaryTextColor:'#aaaaaa',mutedTextColor:'#777777',borderColor:'#333333',accent:'#00aa88',
      opacity:0.03,gradientColor:'#123456',gradientAngle:155,backgroundSize:'contain',
      backgroundPosition:'top',backgroundName:'wall.jpg',
      regions:{
        content:{opacity:0.5,blur:12,radius:20,backgroundColor:'#111111',borderColor:'#222222',shadow:1},
        sidebar:{opacity:1,blur:0}
      }
    });
    expect((settings.regions as Record<string,unknown>).unknown).toBeUndefined();
  });
  it('保留已保存的自定义几何和强调色',async()=>{
    const h=await harness();open.push(h);
    const custom={...appearanceDefaults,followStudio:false,radius:28,borderWidth:3.5,letterSpacing:-1.2,accent:'#584765'};
    await unwrap(h,'appearance.save',custom);
    expect(await unwrap(h,'appearance.get')).toMatchObject({settings:custom});
  });
  it('紧凑外观可在 iOS 标题长度内完整往返，不接受截断或混用的参数',async()=>{
    const h=await harness();open.push(h);
    const region={backgroundColor:'#123abc',borderColor:'#abc123',opacity:0.87,blur:29.99,radius:31.99,shadow:1.99};
    const settings=normalizeAppearance({...appearanceDefaults,followStudio:false,colorScheme:'light',font:'system',
      fontSize:19.99,lineHeight:2.39,radius:31.99,controlHeight:55.99,borderWidth:3.99,spacing:1.59,letterSpacing:-1.49,
      shadow:1.99,contentWidth:1599.99,gradientAngle:359.99,overlay:0.84,blur:23.99,opacity:0.99,
      gradientColor:'#c0ffee',backgroundSize:'contain',backgroundPosition:'bottom',
      backgroundName:'桌'.repeat(120),backgroundMobileName:'移'.repeat(120),
      regions:Object.fromEntries(appearanceRegions.map(name=>[name,region]))});
    const wire=encodeAppearanceSave(settings),__requestId='as-123456abcdef';
    const channel='c'.repeat(128),id=123456789;
    const text=JSON.stringify({channel,type:'request',id,method:'rpc',args:{name:'appearance.save',input:{wire,__requestId}}});
    const title=`ekko-plugin://${channel}/${id}/${encodeURIComponent(JSON.stringify({id,part:0,total:1,text}))}#${id}`;
    expect(title.length).toBeLessThan(1000);
    expect(decodeAppearanceSave(wire)).toEqual({...settings,backgroundName:'',backgroundMobileName:''});
    expect(decodeAppearanceSave(encodeAppearanceSave(appearanceDefaults))).toEqual(appearanceDefaults);
    const {uploadId}=await unwrap(h,'appearance.background-start',{name:'移动背景.jpg',mime:'image/jpeg',slot:'mobile'});
    await unwrap(h,'appearance.background-chunk',{uploadId,data:jpeg.toString('base64')});
    await unwrap(h,'appearance.background-complete',{uploadId,name:'移动背景.jpg',mime:'image/jpeg',slot:'mobile'});
    await expect(unwrap(h,'appearance.save',{wire,__requestId})).resolves.toEqual({saved:true});
    for(const input of [{wire:wire.slice(0,-1)},{wire:wire.replace(/^1!/,'2!')},{wire,font:'mono'}]){
      await expect(h.call('appearance.save',input)).resolves.toMatchObject({ok:false,error:{code:'VALIDATION'}});
    }
    expect(await unwrap(h,'appearance.get')).toMatchObject({settings:{...settings,backgroundName:'',backgroundMobileName:'移动背景.jpg'}});
  });
  it('外观保存与核对日志只记录诊断编号和处理阶段，契约拒绝也可追踪',async()=>{
    const h=await harness();open.push(h);
    const id='as-123456abcdef',invalid='as-654321abcdef';
    await unwrap(h,'appearance.save',{...appearanceDefaults,accent:'#584765',__requestId:id});
    await unwrap(h,'appearance.get',{__requestId:`${id}-check`});
    await expect(h.call('appearance.save',{__requestId:invalid,unknown:'private'}))
      .resolves.toMatchObject({ok:false,error:{code:'VALIDATION'}});
    const traced=h.logs.filter(record=>JSON.stringify(record).includes(' trace=')).map(record=>(record as {message:string}).message);
    expect(traced).toEqual([
      ...['received','running','persisted','returning'].map(phase=>`[ekko-tools] appearance.save trace=${id} phase=${phase}`),
      ...['received','running','returning'].map(phase=>`[ekko-tools] appearance.get trace=${id}-check phase=${phase}`),
      ...['received','rejected'].map(phase=>`[ekko-tools] appearance.save trace=${invalid} phase=${phase}`)
    ]);
  });
  it('其他设置等待存储写入时，外观仍可保存并重新读取',async()=>{
    let block!:()=>void,release!:()=>void;
    const entered=new Promise<void>(resolve=>{block=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const wrap=(store:Storage):Storage=>({...store,namespace:(...segments)=>wrap(store.namespace(...segments)),
      set:async(key,value)=>{if(key==='preferences'){block();await gate;}await store.set(key,value);}
    });
    const h=await harness({storage:wrap(memoryStorage())});open.push(h);
    const other=unwrap(h,'settings.save',{selection:false});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      await entered;
      const appearance=unwrap(h,'appearance.save',{...appearanceDefaults,font:'mono'});
      await expect(Promise.race([appearance,new Promise(resolve=>{timer=setTimeout(()=>resolve('blocked'),300);})]))
        .resolves.toEqual({saved:true});
      expect(await unwrap(h,'appearance.get')).toMatchObject({settings:{font:'mono'}});
    }finally{clearTimeout(timer);release();await other;}
  });
  it('排队中的外观保存被取消后不会覆盖已保存的设置',async()=>{
    const h=await harness();open.push(h);
    const prior=unwrap(h,'appearance.save',{...appearanceDefaults,font:'serif'});
    const queued=h.call('appearance.save',{...appearanceDefaults,font:'mono',__requestId:'queued-save'});
    await unwrap(h,'app.cancel',{requestId:'queued-save'});
    await expect(prior).resolves.toEqual({saved:true});
    await expect(queued).resolves.toMatchObject({ok:false,error:{code:'TIMEOUT'}});
    expect(await unwrap(h,'appearance.get')).toMatchObject({settings:{font:'serif'}});
  });
  it('分块保存原图到 dataDir，存储只保留元数据',async()=>{
    const h=await harness();open.push(h);
    const data=jpeg.toString('base64');
    const {uploadId}=await unwrap(h,'appearance.background-start',{name:'bg.jpg',mime:'image/jpeg'});
    expect(await unwrap(h,'appearance.background-chunk',{uploadId,data})).toEqual({received:jpeg.length});
    expect(await unwrap(h,'appearance.background-complete',{uploadId,name:'bg.jpg',mime:'image/jpeg'}))
      .toEqual({saved:true,name:'bg.jpg',bytes:jpeg.length});
    const saved=await unwrap(h,'appearance.get');
    expect(saved).toMatchObject({hasBackground:true,backgroundName:'bg.jpg',backgroundMime:'image/jpeg'});
    const read=await unwrap(h,'appearance.background-read',{offset:0,length:525000});
    expect(Buffer.from(read.data,'base64')).toEqual(jpeg);
    const store=h.storage.namespace('v2','users','1','profiles','test');
    expect(await store.get('appearance-bg')).toBeUndefined();
    expect(await store.get('appearance-bg-meta')).toMatchObject({mime:'image/jpeg',bytes:jpeg.length});
    const files=await readdir(join(h.directory,'appearance'));
    expect(files).toHaveLength(1);
    expect(await readFile(join(h.directory,'appearance',files[0]))).toEqual(jpeg);
  });
  it('扩展名与实际格式不一致时按真实格式保存',async()=>{
    const h=await harness();open.push(h);
    const data=jpeg.toString('base64');
    const {uploadId}=await unwrap(h,'appearance.background-start',{name:'bg.png',mime:'image/png'});
    await unwrap(h,'appearance.background-chunk',{uploadId,data});
    expect(await unwrap(h,'appearance.background-complete',{uploadId,name:'bg.png',mime:'image/png'}))
      .toMatchObject({saved:true,bytes:jpeg.length});
    expect(await unwrap(h,'appearance.get')).toMatchObject({hasBackground:true,backgroundMime:'image/jpeg'});
  });
  it('Web 与移动背景独立保存、读取和清除',async()=>{
    const h=await harness();open.push(h);
    const mobile=Buffer.from([0xff,0xd8,0xff,0xdb,9,8,7]);
    const upload=async(name:string,slot:'desktop'|'mobile',body:Buffer)=>{
      const {uploadId}=await unwrap(h,'appearance.background-start',{name,mime:'image/jpeg',slot});
      await unwrap(h,'appearance.background-chunk',{uploadId,data:body.toString('base64')});
      await unwrap(h,'appearance.background-complete',{uploadId,name,mime:'image/jpeg',slot});
    };
    await upload('web.jpg','desktop',jpeg);
    await upload('phone.jpg','mobile',mobile);
    expect(await unwrap(h,'appearance.get')).toMatchObject({
      hasBackground:true,backgroundName:'web.jpg',hasMobileBackground:true,mobileBackgroundName:'phone.jpg',
    });
    expect(Buffer.from((await unwrap(h,'appearance.background-read',{offset:0,slot:'mobile'})).data,'base64')).toEqual(mobile);
    expect(await readdir(join(h.directory,'appearance'))).toHaveLength(2);
    expect(await unwrap(h,'appearance.background-clear',{slot:'mobile'})).toEqual({cleared:true});
    expect(await unwrap(h,'appearance.get')).toMatchObject({
      hasBackground:true,hasMobileBackground:false,settings:{backgroundMobileName:''},
    });
    expect(Buffer.from((await unwrap(h,'appearance.background-read',{offset:0,slot:'desktop'})).data,'base64')).toEqual(jpeg);
  });
  it('读取时迁移旧 data URL，清除后删除文件与元数据',async()=>{
    const h=await harness();open.push(h);
    const store=h.storage.namespace('v2','users','1','profiles','test');
    await store.set('appearance-bg',`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    await store.set('appearance-bg-name','legacy.jpg');
    const loaded=await unwrap(h,'appearance.get');
    expect(loaded).toMatchObject({hasBackground:true,hasMobileBackground:false,backgroundName:'legacy.jpg',backgroundMime:'image/jpeg'});
    expect(await store.get('appearance-bg')).toBeUndefined();
    expect(await store.get('appearance-bg-meta')).toMatchObject({name:'legacy.jpg'});
    expect(await unwrap(h,'appearance.background-clear')).toEqual({cleared:true});
    expect(await store.get('appearance-bg-meta')).toBeUndefined();
    expect(await readdir(join(h.directory,'appearance'))).toHaveLength(0);
  });
  it('外观设置保存、恢复默认并同步背景文件名',async()=>{
    const h=await harness();open.push(h);
    await unwrap(h,'appearance.save',{...appearanceDefaults,font:'mono',fontSize:17,accent:'#123456'});
    expect(await unwrap(h,'appearance.get')).toMatchObject({settings:{font:'mono',fontSize:17,accent:'#123456'}});
    expect(await unwrap(h,'appearance.reset')).toEqual({reset:true});
    expect(await unwrap(h,'appearance.get')).toMatchObject({hasBackground:false,settings:appearanceDefaults});
  });
  it('外观或背景变更广播给其他已打开页面',async()=>{
    const h=await harness();open.push(h);
    await unwrap(h,'appearance.save',{...appearanceDefaults,font:'mono'});
    expect(h.events.some(event=>event.type==='appearance.updated'&&event.options?.audience==='plugin')).toBe(true);
    h.events.length=0;
    const data=jpeg.toString('base64');
    const {uploadId}=await unwrap(h,'appearance.background-start',{name:'bg.jpg',mime:'image/jpeg'});
    await unwrap(h,'appearance.background-chunk',{uploadId,data});
    await unwrap(h,'appearance.background-complete',{uploadId,name:'bg.jpg',mime:'image/jpeg'});
    expect(h.events.some(event=>event.type==='appearance.updated'&&event.data.updatedAt>0)).toBe(true);
    h.events.length=0;
    await unwrap(h,'appearance.background-clear',{slot:'desktop'});
    expect(h.events.some(event=>event.type==='appearance.updated')).toBe(true);
  });
});
