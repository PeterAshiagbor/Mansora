import { afterEach, describe, expect, it } from 'vitest';
import { defaultTaxConfig } from '../../packages/domain/src';
import { makeShop, uuid, expectCode, type TestShop } from '../helpers';
const shops: TestShop[] = [];
afterEach(() => { for (const s of shops.splice(0)) s.engine.db.close(); });
async function shop(registered = true, registrationDate = '2026-01-01') {
  const s = await makeShop({ now: () => new Date('2026-11-15T12:00:00Z') }); shops.push(s);
  await s.run(s.owner,'tax.configure',{ ...defaultTaxConfig(), registered, registrationDate: registered ? registrationDate : null, tin: 'AUDIT-TIN', vatNumber: 'AUDIT-VAT', reason: 'Synthetic audit fixture' });
  return s;
}
const input = (extra: object = {}) => ({ id: uuid(),kind:'input',date:'2026-11-15',invoiceDate:'2026-10-01',reference:uuid(),supplierTin:'SUP-1',base:100000,vat:15000,nhil:2500,getfund:2500,reason:'Eligible invoice held and reviewed',evidenceConfirmed:true,...extra });
describe('Financial-adviser VAT counterexamples', () => {
  it('uses the exact six-month accrual deadline, not the start of the claim month', async () => {
    const s = await shop();
    await expectCode(s.run(s.owner,'tax.record',input({ invoiceDate:'2026-05-01' })),'INPUT_CREDIT_PERIOD');
    await s.run(s.owner,'tax.record',input({ invoiceDate:'2026-05-15' }));
    await expectCode(s.run(s.owner,'tax.record',input({ invoiceDate:'2026-05-01',accrualDate:'2026-11-01' })),'INPUT_ACCRUAL_EVIDENCE_REQUIRED');
  });
  it('blocks statutory exclusions and applies the mixed-supply five/ninety-five percent rules', async () => {
    const s = await shop();
    for (const inputCategory of ['membership','vehicle','entertainment']) await expectCode(s.run(s.owner,'tax.record',input({inputCategory})),'INPUT_CREDIT_BLOCKED');
    await expectCode(s.run(s.owner,'tax.record',input({attribution:'exempt'})),'INPUT_CREDIT_BLOCKED');
    await expectCode(s.run(s.owner,'tax.record',input({attribution:'residual_mixed',financialInstitution:true})),'INPUT_CREDIT_BLOCKED');
    await s.run(s.owner,'tax.record',input({attribution:'residual_mixed',eligibleBps:499}));
    await s.run(s.owner,'tax.record',input({attribution:'residual_mixed',eligibleBps:9501}));
    const r = await s.run(s.owner,'tax.report',{month:'2026-11'});
    expect(r.buckets[0].inputs).toBe(15000);
  });
  it('requires pre-registration goods on hand, correct lookback and the first registration period', async () => {
    const s = await shop(true,'2026-10-01');
    await expectCode(s.run(s.owner,'tax.record',input({invoiceDate:'2026-09-01'})),'PRE_REGISTRATION_INPUT');
    await expectCode(s.run(s.owner,'tax.record',input({date:'2026-10-15',invoiceDate:'2026-09-01',inputCategory:'services',onHandAtRegistration:true})),'PRE_REGISTRATION_INPUT');
    await s.run(s.owner,'tax.record',input({date:'2026-10-15',invoiceDate:'2026-04-01',inputCategory:'capital',onHandAtRegistration:true}));
    const r = await s.run(s.owner,'tax.report',{month:'2026-10'});
    expect(r.buckets[0].inputs).toBe(15000);
  });
  it('cannot claim the same supplier invoice by changing case or spaces', async () => {
    const s = await shop();
    await s.run(s.owner,'tax.record',input({reference:'INV 123',supplierTin:'sup-1'}));
    await expectCode(s.run(s.owner,'tax.record',input({reference:' inv123 ',supplierTin:' SUP-1 '})),'DUPLICATE_TAX_INVOICE');
  });
  it('retains the original legal date when a threshold crossing is discovered late', async () => {
    const s = await shop(false);
    await s.run(s.owner,'tax.configure',{...defaultTaxConfig(),registered:true,registrationDate:'2026-12-01',tin:'AUDIT-TIN',reason:'Future certificate date does not delay existing legal liability'});
    await s.run(s.owner,'tax.record',{id:uuid(),kind:'turnover',date:'2026-10-15',reference:'Late-entered October branch sales',base:75000001,reason:'Verified dated external supplies',evidenceConfirmed:true});
    const status = await s.run(s.owner,'tax.status');
    expect(status.pendingTrigger).toMatchObject({requirementDate:'2026-10-15',effectiveDate:'2026-11-01',detectedDate:'2026-11-15'});
    expect(status.registered).toBe(true);
  });
  it('discovers an earlier obligation even when a later registration is already active', async () => {
    const s = await shop(true,'2026-11-01');
    await s.run(s.owner,'tax.record',{id:uuid(),kind:'turnover',date:'2026-10-15',reference:'October crossing',base:75000001,reason:'Verified late history',evidenceConfirmed:true});
    await s.run(s.owner,'tax.record',{id:uuid(),kind:'turnover',date:'2026-09-15',reference:'Earlier September crossing',base:75000001,reason:'Earlier verified late history',evidenceConfirmed:true});
    expect((await s.run(s.owner,'tax.current')).registrationDate).toBe('2026-10-01');
    const october = await s.run(s.owner,'tax.report',{month:'2026-10'});
    expect(october.blockers.join(' ')).toContain('External taxable turnover');
  });
  it('includes registered external sales in output and reconciles threshold-only records without double counting', async () => {
    const s = await shop(false), original = uuid();
    await s.run(s.owner,'tax.record',{id:original,kind:'turnover',date:'2026-11-01',reference:'Branch totals',base:100000,reason:'Verified external supplies',evidenceConfirmed:true});
    await s.run(s.owner,'tax.configure',{...defaultTaxConfig(),registered:true,registrationDate:'2026-01-01',tin:'AUDIT-TIN',reason:'Confirmed earlier registration'});
    expect((await s.run(s.owner,'tax.report',{month:'2026-11'})).blockers.join(' ')).toContain('External taxable turnover');
    await expectCode(s.run(s.owner,'tax.record',{id:uuid(),kind:'turnover',date:'2026-11-02',reference:'Wrong workflow',base:100000,reason:'Branch',evidenceConfirmed:true}),'EXTERNAL_SALE_REQUIRED');
    await s.run(s.owner,'tax.record',{id:uuid(),kind:'external_sale',date:'2026-11-01',reference:'EXT-1',reconcilesTurnoverId:original,base:100000,vat:15000,nhil:2500,getfund:2500,reason:'Registered branch invoice',evidenceConfirmed:true});
    const report = await s.run(s.owner,'tax.report',{month:'2026-11'});
    expect(report.output).toMatchObject({base:100000,vat:15000,nhil:2500,getfund:2500,total:120000});
    expect((await s.run(s.owner,'tax.status')).annual.total).toBe(100000);
    expect(report.blockers).toEqual([]);
  });
  it('requires authority for rule overrides and effective deregistration', async () => {
    const s = await shop();
    await expectCode(s.run(s.owner,'tax.configure',{...defaultTaxConfig(),vatBps:0,reason:'Attempt to omit VAT'}),'TAX_RULE_AUTHORITY_REQUIRED');
    await expectCode(s.run(s.owner,'tax.configure',{...defaultTaxConfig(),automatic:false,reason:'Attempt to stop VAT'}),'DEREGISTRATION_AUTHORITY_REQUIRED');
  });
  it('blocks unregistered filing and does not allow an unsupported prior-period offset', async () => {
    const s = await shop(false);
    await expectCode(s.run(s.owner,'tax.file',{id:uuid(),month:'2026-10',reference:'ACK',reason:'Cannot attest completeness',reviewed:true,fiscalEvidenceConfirmed:true,submittedDate:'2026-11-15'}),'VAT_RECONCILIATION_REQUIRED');
    const r = await shop();
    await expectCode(r.run(r.owner,'tax.record',{id:uuid(),kind:'adjustment',date:'2026-11-01',originalPeriod:'2026-10',legalAuthority:'Prior-return correction',reference:'A',reason:'Wrong period',vat:-100,evidenceConfirmed:true}),'TAX_ADJUSTMENT_REVIEW_REQUIRED');
  });
  it('preserves original filings and requires GRA authority and ordered refiling for amendments', async () => {
    const s = await shop(), filing = uuid();
    await s.run(s.owner,'tax.file',{id:filing,month:'2026-10',reference:'ORIGINAL-ACK',reason:'Filed nil return',reviewed:true,fiscalEvidenceConfirmed:true,submittedDate:'2026-11-01'});
    await s.run(s.owner,'tax.reopen',{id:uuid(),filingId:filing,month:'2026-10',applicationDate:'2026-11-10',approvalReference:'GRA-APPROVAL',legalAuthority:'Section 63 written approval',reason:'Correct October output',approvalConfirmed:true});
    await s.run(s.owner,'tax.record',{id:uuid(),kind:'adjustment',date:'2026-10-01',reference:'CORRECTION',legalAuthority:'GRA-APPROVAL',originalPeriod:'2026-10',reason:'Approved output adjustment',vat:100,evidenceConfirmed:true});
    await s.run(s.owner,'tax.file',{id:uuid(),month:'2026-10',reference:'AMENDED-ACK',reason:'Approved amended return filed',reviewed:true,fiscalEvidenceConfirmed:true,submittedDate:'2026-11-15'});
    expect((s.engine.db.prepare("SELECT COUNT(*) AS n FROM tax_records WHERE kind='filing'").get() as any).n).toBe(2);
    expect((await s.run(s.owner,'tax.report',{month:'2026-10'})).payable).toBe(100);
    await expectCode(s.run(s.owner,'tax.reopen',{id:uuid(),filingId:filing,month:'2026-10',applicationDate:'2026-11-15',approvalReference:'OLD-VERSION',legalAuthority:'Wrong acknowledgement',reason:'Stale reference',approvalConfirmed:true}),'STALE_FILING_REFERENCE');
  });
  it('quotes tax-inclusive consumer prices and prints an invoice-linked credit note', async () => {
    const s = await shop();
    await s.run(s.owner,'tax.configure',{...defaultTaxConfig(),registered:true,registrationDate:'2026-01-01',tin:'AUDIT-TIN',pricing:'exclusive',reason:'Exclusive catalogue'});
    await s.run(s.owner,'product.save',{id:s.products.milk,name:'Milk',sellingPrice:10000,taxClass:'standard'});
    const product = (await s.run(s.cashier,'product.list')).find((p:any)=>p.id===s.products.milk);
    expect(product.display_price).toBe(12000);
    const customer = await s.run(s.cashier,'customer.add',{name:'Business buyer',tin:'BUYER-TIN',address:'Accra'});
    const sale = await s.run(s.cashier,'sale.complete',{id:uuid(),customerId:customer.id,lines:[{productId:s.products.milk,quantity:1}],tenders:[{method:'cash',amount:12000}]});
    const detail = await s.run(s.cashier,'sale.get',{id:sale.id});
    const refund = await s.run(s.cashier,'refund.create',{id:uuid(),saleId:sale.id,reason:'Returned unopened',lines:[{saleItemId:detail.items[0].id,quantity:1}],approver:{username:'ama',password:'owner-pass-1'}});
    const note = await s.run(s.cashier,'refund.receipt',{id:refund.id});
    for (const text of ['Tax credit note',sale.receiptNo,'BUYER-TIN','Returned unopened','15.00','2.50']) expect(note.html).toContain(text);
    expect((await s.run(s.owner,'report.sales',{from:'2026-11-01',to:'2026-11-30'})).totals.netExcludingTax).toBe(0);
  });
  it('does not activate a general forecast withdrawn before the required month-end assessment', async () => {
    let time = new Date('2026-10-15T12:00:00Z');
    const s = await makeShop({now:()=>time}); shops.push(s);
    await s.run(s.owner,'tax.configure',{...defaultTaxConfig(),forecast:80000000,reason:'Potential orders'});
    await s.run(s.owner,'tax.configure',{...defaultTaxConfig(),effectiveDate:'2026-10-20',forecast:0,reason:'Orders cancelled before month end'});
    time = new Date('2026-11-15T12:00:00Z');
    const token=(await s.run(null,'auth.login',{username:'ama',password:'owner-pass-1'})).token;
    expect((await s.run(token,'tax.current')).registered).toBe(false);
  });

  it('reconciles an under-recorded inclusive sale without changing the original and reverses its corrected tax on a later refund', async () => {
    const s=await shop(false);
    await s.run(s.owner,'product.save',{id:s.products.milk,name:'Milk',sellingPrice:6000,taxClass:'standard'});
    const sale=await s.run(s.cashier,'sale.complete',{id:uuid(),lines:[{productId:s.products.milk,quantity:2}],tenders:[{method:'cash',amount:12000}]});
    const original=await s.run(s.cashier,'sale.get',{id:sale.id});
    await s.run(s.owner,'tax.record',{id:uuid(),kind:'turnover',date:'2026-10-15',reference:'Late legal-date evidence',base:75000001,reason:'Verified source',evidenceConfirmed:true});
    expect((await s.run(s.owner,'tax.report',{month:'2026-11'})).blockers.join(' ')).toContain('without VAT');
    await s.run(s.owner,'tax.record',{id:uuid(),kind:'adjustment',date:'2026-11-15',originalPeriod:'2026-11',reconcilesSaleItemId:original.items[0].id,reference:'ADVISER-RECON',legalAuthority:'Documented original-period tax treatment',reason:'Inclusive sale subject to VAT from 1 November',vat:1500,nhil:250,getfund:250,evidenceConfirmed:true});
    const report=await s.run(s.owner,'tax.report',{month:'2026-11'});
    expect(report.payable).toBe(2000); expect(report.blockers).toEqual([]);
    expect(report.classification.find((v:any)=>v.classification==='standard').base).toBe(10000);
    expect((await s.run(s.cashier,'sale.get',{id:sale.id})).items[0].tax_snapshot).toBe(original.items[0].tax_snapshot);
    const refund=await s.run(s.cashier,'refund.create',{id:uuid(),saleId:sale.id,reason:'One returned',lines:[{saleItemId:original.items[0].id,quantity:1}],approver:{username:'ama',password:'owner-pass-1'}});
    expect((await s.run(s.owner,'tax.report',{month:'2026-11'})).payable).toBe(1000);
    expect((await s.run(s.cashier,'refund.receipt',{id:refund.id})).html).toContain('Adjusted value after this credit note: 50.00');
  });

});
