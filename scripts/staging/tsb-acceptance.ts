/** Owner-authorised synthetic TSB rehearsal through the authenticated public gateway. Off by default. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { TestAccount } from './bootstrap';
import type { StagingWorkspace } from './gateway';

export async function rehearseTsb(options:{mode:string;version?:string;origin:string;dataDir:string;workspaces:StagingWorkspace[];fetch?:typeof fetch}) {
  if (!options.version) return {disabled:true};
  if (options.mode!=='team-test' || options.version!=='r16-02-v1') throw new Error('TSB_ACCEPTANCE_MODE_REQUIRED');
  const workspace=options.workspaces.find(w=>w.id==='shop-b');
  if (!workspace) throw new Error('TSB_ACCEPTANCE_WORKSPACE_REQUIRED');
  const account=(JSON.parse(readFileSync(join(options.dataDir,'test-accounts.json'),'utf8')) as TestAccount[]).find(a=>a.workspace==='shop-b' && a.role==='owner');
  if (!account) throw new Error('TSB_ACCEPTANCE_ASSIGNED_OWNER_REQUIRED');
  const base=new URL(options.origin);if(base.pathname!=='/' || base.search || base.hash || base.username || base.password || (base.protocol!=='https:' && !(base.protocol==='http:' && ['127.0.0.1','localhost'].includes(base.hostname)))) throw new Error('TSB_ACCEPTANCE_ORIGIN_REQUIRED');
  const path=join(options.dataDir,'tsb-acceptance-r16-02-v1.json');
  const journal:any=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{version:options.version,tenantId:workspace.engine.meta('tenant_id'),startedAt:new Date().toISOString(),checks:[]};
  if(journal.tenantId!==workspace.engine.meta('tenant_id') || journal.version!==options.version) throw new Error('TSB_ACCEPTANCE_JOURNAL_MISMATCH');
  if(journal.complete) return {preserved:true,...journal};
  const save=()=>{writeFileSync(path+'.pending',JSON.stringify(journal,null,2)+'\n',{mode:0o600});renameSync(path+'.pending',path);};
  const stable=(kind:string)=>{const h=createHash('sha256').update(options.version+'/'+journal.tenantId+'/'+kind).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
  let cookie='',sale:any,details:any,refunded=false;
  const call=async(command:string,input:unknown={})=>{
    const response=await (options.fetch??fetch)(new URL('/client/shop-b/invoke',base),{method:'POST',headers:{origin:base.origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({command,input}),signal:AbortSignal.timeout(30000)});
    const value:any=await response.json();const setCookie=response.headers.get('set-cookie');if(setCookie) cookie=setCookie.split(';')[0];
    if(!response.ok || !value.ok) throw new Error(`TSB_ACCEPTANCE_COMMAND_FAILED:${command}:${response.status}:${String(value.error?.code??value.code??'UNKNOWN').replace(/[^A-Z_]/g,'')}`);
    return value.data;
  };
  const check=(name:string)=>{if(!journal.checks.includes(name))journal.checks.push(name);save();};
  try {
    await call('auth.login',{username:account.username,password:account.password});check('authenticated public gateway owner login');
    const status=await call('tax.status');assert.equal(status.registered,true,'VAT obligation must already be active');assert.notEqual(status.feature?.enabled,false,'Mansora VAT feature must already be on');
    const sku='R16-02-TSB-SYNTHETIC';let product=await call('product.lookup',{code:sku});
    if(!product){const made=await call('product.save',{name:'REHEARSAL · R16-02 VAT item',sku,sellingPrice:12000,costPrice:6000,openingStock:2,taxClass:'standard'});product=(await call('product.list')).find((p:any)=>p.id===made.id);}
    assert.equal(product.tax_class,'standard');assert.equal(product.selling_price,12000);
    journal.productId=product.id;save();
    const existing=await call('shift.current');
    if(!existing){const opened=await call('shift.open',{openingFloat:0});journal.createdShiftId=opened.id;save();}
    const quote=await call('sale.quote',{lines:[{productId:product.id,quantity:1}],cartDiscount:0});
    assert.deepEqual({total:quote.total,vat:quote.tax.vat,nhil:quote.tax.nhil,getfund:quote.tax.getfund},{total:12000,vat:1500,nhil:250,getfund:250});check('trusted VAT quote matches independently calculated GHS 120 split');
    if(journal.stockBefore===undefined){journal.stockBefore=product.quantity;const current=await call('shift.current');journal.cashBefore=current.totals.expectedCash;save();}
    journal.saleId=stable('sale');journal.saleAttempted=true;save();
    sale=await call('sale.complete',{id:stable('sale'),lines:[{productId:product.id,quantity:1}],tenders:[{method:'cash',amount:12000,reference:'SYNTHETIC R16-02 REHEARSAL'}]});journal.saleId=sale.id;save();
    details=await call('sale.get',{id:sale.id});assert.equal(details.sale.total,12000);assert.equal(JSON.parse(details.items[0].tax_snapshot).vat,1500);
    const receipt=await call('sale.receipt',{id:sale.id});assert.ok(receipt.html.includes('15.00'));assert.ok(receipt.html.includes(sale.receiptNo??receipt.receiptNo));check('sale, immutable VAT snapshot and rendered receipt');
    const refund=await call('refund.create',{id:stable('refund'),saleId:sale.id,reason:'SYNTHETIC R16-02 full reversal; no real goods or cash',lines:[{saleItemId:details.items[0].id,quantity:1,restock:true}]});refunded=true;journal.refundId=refund.id;delete journal.cleanupRequired;save();
    const note=await call('refund.receipt',{id:refund.id});assert.ok(note.html.includes('15.00'));check('full refund and rendered credit note');
    const after=await call('product.lookup',{code:sku});assert.equal(after.quantity,journal.stockBefore);const current=await call('shift.current');assert.equal(current.totals.expectedCash,journal.cashBefore);check('stock and expected till cash restored');
    const month=details.sale.created_at.slice(0,7),report=await call('tax.report',{month,includeRows:true});
    const source=report.sales.find((r:any)=>r.id===sale.id),reversal=report.refunds.find((r:any)=>r.id===refund.id);assert.equal(JSON.parse(source.tax_snapshot).vat,1500);assert.equal(JSON.parse(reversal.tax_snapshot).vat,1500);check('original-period sale and VAT reversal appear in report');
    const exported=await call('tax.export',{month}),bytes=Buffer.from(exported.contentBase64,'base64'),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as any);
    assert.ok(workbook.getWorksheet('Sales'));assert.ok(workbook.getWorksheet('Credit notes'));assert.ok(workbook.getWorksheet('Return summary'));journal.exportSha256=createHash('sha256').update(bytes).digest('hex');journal.exportBytes=bytes.length;check('downloaded VAT workbook parses with required schedules');
    const sync=await call('sync.run');assert.equal(sync.ok,true);assert.equal(sync.rejected,0);check('cloud sync accepted rehearsal facts');
    if(journal.createdShiftId && current.id===journal.createdShiftId) await call('shift.close',{countedCash:current.totals.expectedCash,notes:'R16-02 synthetic rehearsal completed; sale fully refunded'});
    journal.complete=true;journal.completedAt=new Date().toISOString();journal.recovery='NOT RUN: independent production backup and isolated restore required';save();return journal;
  } catch(error) {
    journal.failedAt=new Date().toISOString();journal.failure=error instanceof Error && error.message.startsWith('TSB_ACCEPTANCE_')?error.message:'TSB_ACCEPTANCE_ASSERTION_OR_TRANSPORT_FAILED';
    if(journal.saleAttempted && !refunded){
      try{details ??=await call('sale.get',{id:journal.saleId});await call('refund.create',{id:stable('refund'),saleId:journal.saleId,reason:'SYNTHETIC R16-02 cleanup after interrupted acceptance',lines:[{saleItemId:details.items[0].id,quantity:1,restock:true}]});journal.cleanupRefunded=true;delete journal.cleanupRequired;}
      catch(cleanupError){if(cleanupError instanceof Error && cleanupError.message.includes(':sale.get:') && cleanupError.message.endsWith(':NOT_FOUND'))journal.cleanupNoCommittedSale=true;else journal.cleanupRequired=true;}
    }
    save();return {complete:false,...journal};
  } finally {
    if(cookie && journal.createdShiftId && (refunded || journal.cleanupRefunded) && !journal.cleanupRequired) {try {const current=await call('shift.current');if(current?.id===journal.createdShiftId)await call('shift.close',{countedCash:current.totals.expectedCash,notes:'Synthetic R16-02 rehearsal cleanup; no real cash'});}catch{journal.shiftReviewRequired=true;save();}}
    if(cookie)await call('auth.logout').catch(()=>{});
  }
}
