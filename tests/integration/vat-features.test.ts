import { expect,it } from 'vitest';
import { defaultTaxConfig } from '../../packages/domain/src';
import { syncNow } from '../../apps/desktop/src/core';
import { makeShop,uuid,expectCode,OWNER,CASHIER } from '../helpers';
import { startCloud } from '../cloud';
it('allows only Mansora admins to change VAT, detects stale edits, syncs and preserves immutable history',async()=>{
 const cloud=await startCloud();let shop:Awaited<ReturnType<typeof makeShop>>|undefined;
 try {
  const client=await cloud.createClient('Synthetic VAT switch');
  const path=`/v1/admin/clients/${client.id}/features/vat`;
  expect((await cloud.api('PUT',path,{enabled:false,reason:'Authorised test',expectedRevision:0},null)).status).toBe(401);
  const disabled=await cloud.api('PUT',path,{enabled:false,reason:'Synthetic owner-requested feature suspension',expectedRevision:0});
  expect(disabled.status).toBe(200);expect(disabled.body.enabled).toBe(false);
  shop=await makeShop({apiUrl:cloud.url,code:client.code,fetch:globalThis.fetch});
  expect(JSON.parse(shop.engine.meta('platform_vat_feature')!).enabled).toBe(false);
  expect((await cloud.api('PUT',path,{enabled:true,reason:'Stale edit',expectedRevision:0})).status).toBe(409);
  const enabled=await cloud.api('PUT',path,{enabled:true,reason:'Resume with historical reconciliation',expectedRevision:disabled.body.revision});
  expect(enabled.body.events.map((e:any)=>e.enabled)).toEqual([false,true]);
  expect(await syncNow(shop.engine)).toMatchObject({ok:true});
  expect(JSON.parse(shop.engine.meta('platform_vat_feature')!).enabled).toBe(true);
  const audit=await cloud.db.platform(q=>q("SELECT detail FROM admin_audit_logs WHERE tenant_id=$1 AND action='client.vat_feature.changed'",[client.id]));expect(audit).toHaveLength(2);
  await expect(cloud.db.platform(q=>q('UPDATE tenant_vat_feature_events SET reason=$1',['tampered']))).rejects.toThrow();
 }finally{shop?.engine.db.close();await cloud.close();}
});
it('backdates VAT exposure, net classifications and partial refunds without changing original cash or invoices',async()=>{
 let clock=new Date('2026-10-15T12:00:00Z');const s=await makeShop({now:()=>clock});
 try {
  await s.run(s.owner,'tax.configure',{...defaultTaxConfig(),registered:true,registrationDate:'2026-01-01',tin:'TEST-TIN',reason:'Synthetic registration'});
  await s.run(s.owner,'product.save',{id:s.products.milk,name:'Milk',sellingPrice:12000,taxClass:'standard'});
  s.engine.setMeta('platform_vat_feature',JSON.stringify({enabled:false,revision:1,events:[]}));
  expect((await s.run(s.owner,'tax.status')).registered).toBe(true);
  const sale=await s.run(s.cashier,'sale.complete',{id:uuid(),lines:[{productId:s.products.milk,quantity:1}],tenders:[{method:'cash',amount:12000}]});
  const original=s.engine.db.prepare('SELECT tax_snapshot FROM sales WHERE id=?').get(sale.id);
  const detail=await s.run(s.cashier,'sale.get',{id:sale.id});
  const snapshot=JSON.parse(detail.items[0].tax_snapshot);expect(snapshot.vat).toBe(0);expect(snapshot.platformVatSuppressed).toBe(true);
  s.engine.setMeta('platform_vat_feature',JSON.stringify({enabled:true,revision:2,events:[]}));clock=new Date('2026-11-15T12:00:00Z');
  s.owner=(await s.engine.execute(null,'auth.login',OWNER)).token; s.cashier=(await s.engine.execute(null,'auth.login',CASHIER)).token;
  const r=await s.run(s.owner,'tax.report',{month:'2026-10'});
  expect(r.output.vat).toBe(0);expect(r.buckets[0]).toMatchObject({historicalExposure:1500,payable:1500});
  expect(r.classification.find((c:any)=>c.classification==='standard').base).toBe(10000);
  expect(s.engine.db.prepare('SELECT tax_snapshot FROM sales WHERE id=?').get(sale.id)).toEqual(original);
  await expectCode(s.run(s.owner,'tax.file',{id:uuid(),month:'2026-10',reference:'not-filed',reason:'Unreconciled',reviewed:true,fiscalEvidenceConfirmed:true,submittedDate:'2026-11-15'}),'VAT_RECONCILIATION_REQUIRED');
  // A later return reverses the exposure in its own period without inventing tax collection.
  await s.run(s.cashier,'refund.create',{id:uuid(),saleId:sale.id,reason:'Synthetic return',lines:[{saleItemId:detail.items[0].id,quantity:1}],approver:{username:'ama',password:'owner-pass-1'}});
  const november=await s.run(s.owner,'tax.report',{month:'2026-11'});
  expect(november.historicalExposure[0].vat).toBe(-1500);
  const next=await s.run(s.cashier,'sale.complete',{id:uuid(),lines:[{productId:s.products.milk,quantity:1}],tenders:[{method:'cash',amount:12000}]});
  const nextLine=(await s.run(s.cashier,'sale.get',{id:next.id})).items[0];expect(JSON.parse(nextLine.tax_snapshot).vat).toBe(1500);
 }finally{s.engine.db.close();}
});
