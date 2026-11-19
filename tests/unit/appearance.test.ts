import {afterEach,describe,expect,it} from 'vitest';
import {appearanceDefaults,normalizeAppearance} from '../../src/server/appearance';
import {harness,unwrap} from '../helpers';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
const open:Awaited<ReturnType<typeof harness>>[]=[];
afterEach(async()=>{for(const h of open.splice(0))await h.close();});
const jpeg=Buffer.from([0xff,0xd8,0xff,0xdb,0,1,2,3,4,5]);
describe('插件外观设置',()=>{
  it('缺省跟随 Studio，数值和颜色均被规范化',()=>{
    expect(normalizeAppearance(undefined)).toEqual(appearanceDefaults);
    expect(normalizeAppearance({fontSize:99,radius:-5,spacing:0,overlay:2,blur:-1,accent:'red'})).toMatchObject({
      fontSize:20,radius:0,spacing:0.8,overlay:0.85,blur:0,accent:appearanceDefaults.accent
    });
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
  it('读取时迁移旧 data URL，清除后删除文件与元数据',async()=>{
    const h=await harness();open.push(h);
    const store=h.storage.namespace('v2','users','1','profiles','test');
    await store.set('appearance-bg',`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    await store.set('appearance-bg-name','legacy.jpg');
    const loaded=await unwrap(h,'appearance.get');
    expect(loaded).toMatchObject({hasBackground:true,backgroundName:'legacy.jpg',backgroundMime:'image/jpeg'});
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
});
