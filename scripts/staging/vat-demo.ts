/** Explicit, additive TSB fixture. Never runs for production or an unassigned/client workspace. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultTaxConfig } from '@mansora/domain';
import type { StagingWorkspace } from './gateway';
import type { TestAccount } from './bootstrap';
export async function seedVatDemo(options:{mode:string;version?:string;dataDir:string;workspaces:StagingWorkspace[]}) {
  if (!options.version) return {disabled:true};
  if (options.mode !== 'team-test' || options.version !== 'tsb-v1') throw new Error('VAT demo requires explicit team-test tsb-v1 mode');
  const workspace=options.workspaces.find(w=>w.id==='shop-b');
  if (!workspace) throw new Error('TSB workspace not available');
  const accounts=JSON.parse(readFileSync(join(options.dataDir,'test-accounts.json'),'utf8')) as TestAccount[];
  const account=accounts.find(a=>a.workspace==='shop-b' && a.role==='owner');
  if (!account) throw new Error('TSB must be an assigned synthetic test shop');
  const engine=workspace.engine;
  const token=(await engine.execute(null,'auth.login',{username:account.username,password:account.password})).token;
  const run=(cmd:string,input:unknown={})=>engine.execute(token,cmd,input);
  const id=(name:string)=>{const h=createHash('sha256').update('vat-demo-tsb-v1/'+engine.meta('tenant_id')+'/'+name).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
  try {
    // Repair older completed fixtures too. This is a fictional standard-rated catalogue,
    // not a legal classification of real goods. Keep choices already made by demo users.
    const missing=engine.db.prepare('SELECT * FROM products WHERE tax_class IS NULL').all() as any[];
    for (const p of missing) await run('product.save',{
      id:p.id,name:p.name,sku:p.sku,barcode:p.barcode,categoryId:p.category_id,
      unit:p.unit,costPrice:p.cost_price,sellingPrice:p.selling_price,
      reorderLevel:p.reorder_level,active:!!p.active,taxClass:'standard',
    });
    if (engine.meta('vat_demo_tsb_v1')==='complete') {
      const config=await run('tax.current');
      if (!config.tin || !config.vatNumber) await run('tax.configure',{
        ...config,effectiveDate:engine.now().toISOString().slice(0,10),
        tin:config.tin || 'DEMO-TSB-NOT-A-REAL-TIN',vatNumber:config.vatNumber || 'DEMO-ONLY',
        reason:'SYNTHETIC TSB demo profile completion; no real GRA registration',
      });
      return {preserved:true,classified:missing.length};
    }
    const today=engine.meta('vat_demo_tsb_date') ?? engine.now().toISOString().slice(0,10), month=today.slice(0,7)+'-01';
    engine.setMeta('vat_demo_tsb_date',today);
    const prior=new Date(month+'T00:00:00Z');prior.setUTCDate(0);const crossing=prior.toISOString().slice(0,10);
    if (crossing<'2026-01-01') throw new Error('VAT demo requires a supported prior month');
    // Every entry is explicitly fictional and uses the public command/audit path. Preserve existing shop records.
    if (!engine.meta('vat_demo_tsb_config')) {
      await run('tax.configure',{...defaultTaxConfig(),registered:false,tin:'DEMO-TSB-NOT-A-REAL-TIN',reason:'SYNTHETIC TSB VAT threshold rehearsal; no GRA registration or submission'});
      engine.setMeta('vat_demo_tsb_config','prepared');
    }
    await run('tax.record',{id:id('threshold'),kind:'turnover',date:crossing,reference:'VAT-DEMO-TSB-THRESHOLD-750001',base:75000100,reason:'SYNTHETIC external turnover GHS 750,001; test all threshold bands only; no real invoice',evidenceConfirmed:true});
    await run('tax.configure',{...defaultTaxConfig(),registered:true,registrationDate:month,tin:'DEMO-TSB-NOT-A-REAL-TIN',vatNumber:'DEMO-ONLY',pricing:'inclusive',reason:'SYNTHETIC VAT obligation from the month after the demo crossing; legacy data still needs review; no GRA registration'});
    let productId=(engine.db.prepare('SELECT id FROM products WHERE sku=?').get('VAT-DEMO-TSB-120') as any)?.id;
    if (!productId) productId=(await run('product.save',{name:'VAT DEMO · Standard item GHS 120',sku:'VAT-DEMO-TSB-120',sellingPrice:12000,costPrice:6000,openingStock:50,taxClass:'standard'})).id;
    if (!engine.db.prepare('SELECT id FROM sales WHERE id=?').get(id('sale'))) {
      const existingShift=await run('shift.current');
      if (!existingShift) await run('shift.open',{openingFloat:0});
      try { await run('sale.complete',{id:id('sale'),lines:[{productId,quantity:1}],tenders:[{method:'cash',amount:12000,reference:'SYNTHETIC VAT DEMO'}]}); }
      finally { if (!existingShift) await run('shift.close',{countedCash:12000,notes:'Synthetic VAT demo; no real cash'}); }
    }
    engine.setMeta('vat_demo_tsb_v1','complete');
    return {prepared:true,month,crossing,thresholdGhs:750001};
  } finally {engine.endSession(token);}
}
