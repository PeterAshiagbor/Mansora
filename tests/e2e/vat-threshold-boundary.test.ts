/** Browser proof: actual till sales cross the threshold; no external turnover or manual registration. */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { defaultTaxConfig } from '@mansora/domain';
import { startStagingGateway } from '../../scripts/staging/gateway';
import { startCloud } from '../cloud';
import { makeShop,OWNER } from '../helpers';
import { navigate } from './navigation';
const pw=(()=>{try{return createRequire(import.meta.url)('playwright');}catch{return null;}})();
it.skipIf(!pw || !existsSync(join(import.meta.dirname,'../../apps/desktop/dist/renderer/index.html')))('automatically crosses the POS boundary, waits for the next month and charges VAT through the browser',async()=>{
 const cloud=await startCloud();const client=await cloud.createClient('Synthetic browser threshold shop');let clock=new Date('2026-10-31T10:00:00Z');
 const s=await makeShop({apiUrl:cloud.url,code:client.code,fetch,now:()=>clock});let gateway:any,browser:any;
 try{
  await s.run(s.owner,'tax.configure',{...defaultTaxConfig(),tin:'BROWSER-BOUNDARY-SYNTHETIC',reason:'Unregistered synthetic goods shop; automatic thresholds only'});
  await s.run(s.owner,'product.save',{name:'Boundary exact threshold item',sellingPrice:75000000,costPrice:1,openingStock:2,taxClass:'standard'});
  await s.run(s.owner,'product.save',{name:'Boundary one pesewa item',sellingPrice:1,costPrice:0,openingStock:2,taxClass:'standard'});
  await s.run(s.owner,'product.save',{name:'Boundary registered VAT item',sellingPrice:12000,costPrice:6000,openingStock:2,taxClass:'standard'});
  await s.run(s.owner,'shift.open',{openingFloat:0});
  gateway=await startStagingGateway({origin:'http://127.0.0.1:0',apiUrl:cloud.url,port:0,workspaces:[{id:'shop-b',label:'Synthetic TSB',engine:s.engine}],clientDir:join(import.meta.dirname,'../../apps/desktop/dist/renderer'),adminDir:join(import.meta.dirname,'../../apps/admin-web/dist')});
  browser=await pw.chromium.launch();const page=await browser.newPage();page.setDefaultTimeout(12000);const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
  const signIn=async()=>{await page.getByLabel('Username',{exact:true}).fill(OWNER.username);await page.getByLabel('Password',{exact:true}).fill(OWNER.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();};
  await page.goto(gateway.url+'/client/shop-b/');await signIn();
  const sell=async(name:string,cash:string)=>{
   await navigate(page,'New sale');await page.getByRole('button').filter({hasText:name}).click();
   await page.getByRole('button',{name:'Pay (F9)',exact:true}).click();await page.getByRole('dialog').getByLabel('Cash received',{exact:true}).fill(cash);
   await page.getByRole('dialog').getByRole('button',{name:/Complete sale/}).click();await page.getByRole('dialog',{name:'Sale completed',exact:true}).waitFor();
   await page.getByRole('button',{name:/New sale.*Enter/}).click();
  };
  await sell('Boundary exact threshold item','750000');
  let status=await s.run(s.owner,'tax.status');expect(status.annual.total).toBe(75000000);expect(status.pendingTrigger).toBeNull();expect(status.registered).toBe(false);
  await sell('Boundary one pesewa item','0.01');
  status=await s.run(s.owner,'tax.status');expect(status.annual.total).toBe(75000001);expect(status.registered).toBe(false);expect(status.pendingTrigger.effectiveDate).toBe('2026-11-01');
  await navigate(page,'Ghana VAT');await page.getByText(/Automatic VAT charging effective 2026-11-01/).waitFor();
  await page.getByRole('button',{name:'Lock / sign out',exact:true}).click();
  clock=new Date('2026-11-01T10:00:00Z');await page.reload();await signIn();
  await sell('Boundary registered VAT item','120');
  const row=s.engine.db.prepare("SELECT tax_snapshot FROM sales ORDER BY created_at DESC LIMIT 1").get() as any;
  expect(JSON.parse(row.tax_snapshot)).toMatchObject({registered:true,base:10000,vat:1500,nhil:250,getfund:250,total:12000});
  expect(Number((s.engine.db.prepare("SELECT COUNT(*) n FROM tax_records WHERE kind='turnover'").get() as any).n)).toBe(0);
  expect(errors).toEqual([]);
 }finally{await browser?.close();await gateway?.close();s.engine.db.close();await cloud.close();}
});
