/** Disposable encrypted VAT-report stress fixture; never connects to a live service. */
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,statSync } from 'node:fs';
import { tmpdir,cpus } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { defaultTaxConfig, ALL_PERMISSIONS } from '@mansora/domain';
import { randomBytes,randomUUID } from 'node:crypto';
import { openEngine } from '../../apps/desktop/src/core';
import { hashPassword } from '../../apps/desktop/src/core/passwords';

const rows:any[]=[];
for(const sales of [1000,10000,50000]){
 const root=mkdtempSync(join(tmpdir(),'mansora-vat-perf-')),e=openEngine({dataDir:root,dbKey:randomBytes(32).toString('hex'),now:()=>new Date('2026-02-15T12:00:00Z')}),owner=randomUUID(),shift=randomUUID(),products=[randomUUID(),randomUUID(),randomUUID()],date='2026-01-15T12:00:00.000Z';
 e.db.prepare("INSERT INTO users (id,username,name,role,permissions,password_hash,created_at,updated_at) VALUES (?,'performance','Synthetic owner','owner',?,?,?,?)").run(owner,JSON.stringify(ALL_PERMISSIONS),hashPassword(randomBytes(24).toString('hex')),date,date);
 const token=e.createSession(owner);
 try{
  const config={...defaultTaxConfig(),registered:true,registrationDate:'2026-01-01',tin:'SYNTHETIC-PERF',pricing:'inclusive' as const,reason:'Synthetic report performance fixture'};
  await e.execute(token,'tax.configure',config);
  const active={classification:'standard',classificationVerified:true,registered:true,rates:[1500,250,250],base:1000,vat:150,nhil:25,getfund:25,total:1200};
  const suppressed={...active,registered:false,base:1200,vat:0,nhil:0,getfund:0,platformVatSuppressed:true,platformPolicyRevision:1,legalConfig:config};
  let off=0;
  const header=e.db.prepare('INSERT INTO sales (id,receipt_no,shift_id,cashier_id,subtotal,total,cash_tendered,cost_total,created_at,tax_snapshot) VALUES (?,?,?,?,3600,3600,3600,900,?,?)');
  const line=e.db.prepare('INSERT INTO sale_items (id,sale_id,product_id,product_name,quantity,unit_price,cost_snapshot,line_total,tax_snapshot) VALUES (?,?,?,\'Synthetic VAT item\',1,1200,300,1200,?)');
  const move=e.db.prepare('INSERT INTO inventory_movements (id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,actor_id,occurred_at) VALUES (?,?,?,?,300,?,?,?,?)');
  const pay=e.db.prepare("INSERT INTO payments (id,sale_id,method,amount) VALUES (?,?,'cash',3600)");
  e.db.transaction(()=>{
    e.db.prepare("INSERT INTO shifts (id,cashier_id,status,opening_float,expected_cash,counted_cash,variance,opened_at,closed_at,reviewed_by,reviewed_at) VALUES (?,?,'reviewed',0,?,?,0,?,?,?,?)").run(shift,owner,sales*3600,sales*3600,date,date,owner,date);
    for(const id of products){
      e.db.prepare("INSERT INTO products (id,name,cost_price,selling_price,tax_class,created_at,updated_at) VALUES (?,'Synthetic VAT item',300,1200,'standard',?,?)").run(id,date,date);
      e.db.prepare('INSERT INTO stock_balances (product_id,quantity,average_cost,version,updated_at) VALUES (?,0,300,?,?)').run(id,sales+1,date);
      move.run(randomUUID(),id,'OPENING_STOCK',sales,'product',id,owner,date);
    }
    for(let i=0;i<sales;i++){
      const id=randomUUID(),disabled=i%10===0,t=disabled?suppressed:active;if(disabled)off++;
      header.run(id,'PERF-'+i,shift,owner,date,JSON.stringify({...t,base:t.base*3,vat:t.vat*3,nhil:t.nhil*3,getfund:t.getfund*3,total:3600}));
      for(const product of products){line.run(randomUUID(),id,product,JSON.stringify(t));move.run(randomUUID(),product,'SALE',-1,'sale',id,owner,date);}
      pay.run(randomUUID(),id);
    }
  })();
  assert.deepEqual(e.db.pragma('foreign_key_check'),[]);
  e.db.pragma('wal_checkpoint(TRUNCATE)');
  const elapsed:number[]=[];
  for(let sample=0;sample<6;sample++){
   const start=performance.now(),r:any=await e.execute(token,'tax.report',{month:'2026-01'}),ms=performance.now()-start;
   assert.equal(r.sales.length,sales*3);assert.equal(r.buckets[0].output,(sales-off)*450);assert.equal(r.buckets[0].historicalExposure,off*450);assert.equal(r.buckets[0].payable,sales*450);assert.equal(r.classification.find((c:any)=>c.classification==='standard').base,sales*3000);
   if(sample>0)elapsed.push(ms);
  }
  elapsed.sort((a,b)=>a-b);const result={sales,saleItems:sales*3,suppressedSales:off,samples:5,medianMs:Math.round(elapsed[2]),p95Ms:Math.round(elapsed[4]),rssMb:Math.round(process.memoryUsage().rss/1024/1024),encryptedDbMb:Math.round(statSync(e.db.name).size/1024/1024),financialAssertions:'passed'};rows.push(result);console.log(JSON.stringify(result));
 }finally{e.db.close();rmSync(root,{recursive:true,force:true});}
}
const report={recordedAt:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,scope:'Local encrypted SQLite stress fixture. Entire reporting period on one synthetic date; 10% collection suppressed. Five warmed samples; p95 is the slowest of five, not a statistically strong production SLO. No live data or production endpoint.',rows};
writeFileSync(new URL('./results/vat-readiness-2026-11-16.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
