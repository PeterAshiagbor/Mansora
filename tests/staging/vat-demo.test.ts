import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { seedVatDemo } from '../../scripts/staging/vat-demo';
import { makeShop,tempDir,OWNER } from '../helpers';
it('adds an idempotent TSB-only threshold fixture and preserves TSA',async()=>{
 const a=await makeShop({now:()=>new Date('2026-11-15T12:00:00Z')}),b=await makeShop({now:()=>new Date('2026-11-15T12:00:00Z')});
 try {
  const dataDir=tempDir();writeFileSync(join(dataDir,'test-accounts.json'),JSON.stringify([{...OWNER,role:'owner',workspace:'shop-b'}]));
  const options={mode:'team-test',version:'tsb-v1',dataDir,workspaces:[{id:'shop-a',label:'TSA',engine:a.engine},{id:'shop-b',label:'TSB',engine:b.engine}]};
  await expect(seedVatDemo({...options,mode:'client'})).rejects.toThrow();
  expect(await seedVatDemo(options)).toMatchObject({prepared:true,thresholdGhs:750001});
  expect((await b.run(b.owner,'tax.status')).windows.every((w:any)=>w.exceeded)).toBe(true);
  expect((await b.run(b.owner,'tax.report',{month:'2026-11'})).output.vat).toBe(1500);
  expect(await seedVatDemo(options)).toMatchObject({preserved:true});
  expect((a.engine.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n).toBe(0);
  expect((b.engine.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n).toBe(1);
 }finally{a.engine.db.close();b.engine.db.close();}
});
