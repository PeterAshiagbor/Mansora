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
  await b.run(b.owner,'product.save',{id:b.products.milk,name:'Milk tin',sellingPrice:1250,taxClass:'exempt'});
  await expect(seedVatDemo({...options,mode:'client'})).rejects.toThrow();
  expect(await seedVatDemo(options)).toMatchObject({prepared:true,thresholdGhs:750001});
  expect((await b.run(b.owner,'tax.status')).unclassified).toBe(0);
  expect((await b.run(b.owner,'product.list')).find((p:any)=>p.id===b.products.milk).tax_class).toBe('exempt');
  expect((await b.run(b.owner,'tax.current')).tin).toBe('DEMO-TSB-NOT-A-REAL-TIN');
  expect((await a.run(a.owner,'tax.status')).unclassified).toBe(3);
  expect((await b.run(b.owner,'tax.status')).windows.every((w:any)=>w.exceeded)).toBe(true);
  expect((await b.run(b.owner,'tax.report',{month:'2026-11'})).output.vat).toBe(1500);
  const added=await b.run(b.owner,'product.save',{name:'Later demo product',sellingPrice:1200});
  expect(await seedVatDemo(options)).toMatchObject({preserved:true});
  expect((await b.run(b.owner,'product.list')).find((p:any)=>p.id===added.id).tax_class).toBe('standard');
  expect(await b.run(b.owner,'sale.quote',{lines:[{productId:added.id,quantity:1}]})).toMatchObject({total:1200});
  expect((a.engine.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n).toBe(0);
  expect((b.engine.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n).toBe(1);
 }finally{a.engine.db.close();b.engine.db.close();}
});
