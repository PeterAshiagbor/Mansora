import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { defaultTaxConfig } from '@mansora/domain';
import { rehearseTsb } from '../../scripts/staging/tsb-acceptance';
import { provisionStaging } from '../../scripts/staging/bootstrap';
import { loadWorkspaces } from '../../scripts/staging/config';
import { startStagingGateway } from '../../scripts/staging/gateway';
import { ADMIN,startCloud } from '../cloud';
import { tempDir } from '../helpers';

async function fixture(){
 const cloud=await startCloud(), staticDir=tempDir();writeFileSync(join(staticDir,'index.html'),'<html><body></body></html>');
 const config={origin:'http://127.0.0.1:0',apiUrl:cloud.url,dataDir:tempDir(),key:randomBytes(32).toString('hex'),clientDir:staticDir,adminDir:staticDir};
 await provisionStaging(config,ADMIN);const workspaces=loadWorkspaces(config),b=workspaces.find(w=>w.id==='shop-b')!;
 const accounts=JSON.parse(readFileSync(join(config.dataDir,'test-accounts.json'),'utf8')),owner=accounts.find((a:any)=>a.workspace==='shop-b' && a.role==='owner');
 const token=(await b.engine.execute(null,'auth.login',owner)).token;
 await b.engine.execute(token,'tax.configure',{...defaultTaxConfig(),registered:true,registrationDate:'2026-01-01',tin:'SYNTHETIC-TIN',reason:'Synthetic registration fixture'});b.engine.endSession(token);
 const gateway=await startStagingGateway({...config,workspaces,port:0});
 return {cloud,config,workspaces,b,gateway,options:{mode:'team-test',version:'r16-02-v1',origin:gateway.url,dataDir:config.dataDir,workspaces},close:async()=>{await gateway.close();for(const w of workspaces)w.engine.db.close();await cloud.close();}};
}
it('exercises authenticated public commands, refund, workbook, cloud sync, and idempotent replay without changing TSA',async()=>{
 const f=await fixture();try{
  const before=createHash('sha256').update(readFileSync(join(f.config.dataDir,'test-accounts.json'))).digest('hex');
  const r=await rehearseTsb(f.options);expect(r).toMatchObject({complete:true});expect((r as any).checks).toContain('cloud sync accepted rehearsal facts');expect((r as any).recovery).toContain('NOT RUN');
  expect(await rehearseTsb(f.options)).toMatchObject({complete:true,preserved:true});
  const counts=(table:string)=>Number((f.b.engine.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n);
  expect(counts('sales')).toBe(1);expect(counts('refunds')).toBe(1);
  expect(Number((f.workspaces.find(w=>w.id==='shop-a')!.engine.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n)).toBe(0);
  expect(createHash('sha256').update(readFileSync(join(f.config.dataDir,'test-accounts.json'))).digest('hex')).toBe(before);
 }finally{await f.close();}
});
it('compensates a committed sale after an assertion failure, retains evidence and resumes without duplicate financial facts',async()=>{
 const f=await fixture();try{
  let breakReceipt=true;
  const transport:typeof fetch=async(url,init)=>{const p=JSON.parse(String(init?.body));if(p.command==='sale.receipt' && breakReceipt)return new Response(JSON.stringify({ok:true,data:{html:'broken'}}),{status:200});return fetch(url,init);};
  const failed:any=await rehearseTsb({...f.options,fetch:transport});expect(failed.complete).toBe(false);expect(failed.cleanupRefunded).toBe(true);expect(failed.cleanupRequired).not.toBe(true);
  expect(Number((f.b.engine.db.prepare('SELECT SUM(quantity) n FROM stock_balances WHERE product_id=?').get(failed.productId) as any).n)).toBe(2);
  breakReceipt=false;expect(await rehearseTsb({...f.options,fetch:transport})).toMatchObject({complete:true});
  expect(Number((f.b.engine.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n)).toBe(1);
  expect(Number((f.b.engine.db.prepare('SELECT COUNT(*) n FROM refunds').get() as any).n)).toBe(1);
 }finally{await f.close();}
});
it('rejects non-test deployment modes before any credentials or workspace access',async()=>{
 await expect(rehearseTsb({mode:'client',version:'r16-02-v1',origin:'https://example.test',dataDir:'/missing',workspaces:[]})).rejects.toThrow('TSB_ACCEPTANCE_MODE_REQUIRED');
 expect(await rehearseTsb({mode:'client',origin:'https://example.test',dataDir:'/missing',workspaces:[]})).toEqual({disabled:true});
});
