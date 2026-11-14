/**
 * C58: a realistic sample of a Ghanaian provisions shop, as an import workbook.
 *
 * Prices are illustrative (cedis, late 2026) and only for trying Mansora: they are not market advice.
 * Barcodes use the 200–299 "in-store" GS1 range, so they can never clash with a real product's barcode.
 */
type Item = [name: string, unit: string, cost: number, price: number];

const CATALOGUE: Record<string, Item[]> = {
  'Rice & grains': [
    ['Royal Feast rice 5kg', 'bag', 118, 135], ['Royal Feast rice 25kg', 'bag', 560, 620], ['Perfumed jasmine rice 5kg', 'bag', 125, 145],
    ['Local brown rice 1kg', 'pack', 18, 22], ['Maize 1 olonka', 'olonka', 22, 28], ['Gari 1kg', 'pack', 12, 15], ['Beans (black-eyed) 1kg', 'pack', 26, 32],
    ['Oats 500g', 'pack', 24, 30], ['Spaghetti 500g', 'pack', 9, 12], ['Macaroni 500g', 'pack', 9, 12], ['Couscous 500g', 'pack', 16, 20], ['Tom Brown 500g', 'pack', 15, 19],
  ],
  'Oils & cooking': [
    ['Vegetable oil 1L', 'bottle', 32, 38], ['Vegetable oil 5L', 'gallon', 150, 172], ['Palm oil 1L', 'bottle', 28, 35], ['Groundnut oil 1L', 'bottle', 38, 45],
    ['Tomato paste 70g sachet', 'sachet', 2.2, 3], ['Tomato paste 400g tin', 'tin', 14, 18], ['Salt 500g', 'pack', 3, 4], ['Sugar 1kg', 'pack', 17, 21],
    ['Seasoning cubes (pack of 50)', 'pack', 18, 24], ['Curry powder 50g', 'sachet', 4, 6], ['Margarine 250g', 'tub', 15, 19], ['Sardines in oil 125g', 'tin', 9, 12],
    ['Mackerel in tomato sauce 425g', 'tin', 22, 27], ['Corned beef 340g', 'tin', 38, 45], ['Baked beans 420g', 'tin', 13, 17],
  ],
  Beverages: [
    ['Milo 400g tin', 'tin', 40, 48], ['Milo 20g sachet', 'sachet', 2, 2.5], ['Bournvita 400g', 'tin', 42, 50], ['Nescafé Classic 50g', 'jar', 34, 42],
    ['Lipton tea (100 bags)', 'box', 32, 38], ['Evaporated milk 160g', 'tin', 8, 10], ['Powdered milk 400g', 'tin', 55, 65], ['Peak milk 400g sachet', 'pack', 48, 56],
    ['Coca-Cola 50cl', 'bottle', 6, 8], ['Fanta orange 50cl', 'bottle', 6, 8], ['Sprite 50cl', 'bottle', 6, 8], ['Malt drink 33cl can', 'can', 7, 9],
    ['Bottled water 1.5L', 'bottle', 3.5, 5], ['Sachet water (bag of 30)', 'bag', 7, 10], ['Fruit juice 1L', 'carton', 18, 23], ['Energy drink 25cl can', 'can', 8, 11],
    ['Tea biscuit 100g', 'pack', 3, 4], ['Cocoa drink 500g', 'tin', 30, 36],
  ],
  'Snacks & sweets': [
    ['Cream crackers 200g', 'pack', 8, 11], ['Digestive biscuits 250g', 'pack', 12, 15], ['Shortbread biscuits 150g', 'pack', 6, 8], ['Plantain chips 100g', 'pack', 5, 7],
    ['Groundnuts roasted 250g', 'pack', 8, 11], ['Chewing gum (pack of 10)', 'pack', 4, 6], ['Toffee sweets (bag of 100)', 'bag', 18, 24], ['Chocolate bar 50g', 'bar', 7, 9],
    ['Popcorn 50g', 'pack', 2.5, 4], ['Cabin biscuits 300g', 'pack', 10, 13],
  ],
  'Bread & bakery': [
    ['Sugar bread loaf', 'loaf', 12, 15], ['Tea bread loaf', 'loaf', 10, 13], ['Wheat bread loaf', 'loaf', 14, 18], ['Butter bread loaf', 'loaf', 13, 16],
    ['Doughnuts (pack of 6)', 'pack', 10, 14], ['Meat pie', 'each', 6, 8],
  ],
  'Toiletries & personal care': [
    ['Bathing soap 150g', 'bar', 6, 8], ['Antiseptic soap 100g', 'bar', 7, 9], ['Toothpaste 140g', 'tube', 14, 18], ['Toothbrush', 'each', 5, 7],
    ['Body lotion 400ml', 'bottle', 32, 40], ['Shea butter 250g', 'tub', 18, 24], ['Petroleum jelly 250ml', 'tub', 15, 19], ['Roll-on deodorant 50ml', 'each', 22, 28],
    ['Sanitary pads (pack of 8)', 'pack', 14, 18], ['Baby diapers (pack of 30)', 'pack', 95, 112], ['Baby wipes (pack of 80)', 'pack', 22, 28], ['Hair cream 250g', 'tub', 20, 26],
    ['Razor blades (pack of 5)', 'pack', 8, 11], ['Toilet roll (pack of 4)', 'pack', 14, 18], ['Hand sanitiser 250ml', 'bottle', 15, 20], ['Cotton buds (pack of 100)', 'pack', 6, 8],
    ['Shampoo 400ml', 'bottle', 30, 38], ['Pomade 100g', 'tub', 10, 14],
  ],
  'Household & cleaning': [
    ['Washing powder 500g', 'pack', 14, 18], ['Washing powder 2kg', 'bag', 52, 62], ['Bar soap (key soap)', 'bar', 5, 7], ['Dishwashing liquid 750ml', 'bottle', 20, 26],
    ['Bleach 1L', 'bottle', 15, 19], ['Toilet cleaner 500ml', 'bottle', 18, 23], ['Insecticide spray 300ml', 'can', 32, 40], ['Mosquito coil (pack of 10)', 'pack', 8, 11],
    ['Sponge scourer', 'each', 3, 5], ['Broom', 'each', 15, 20], ['Matches (pack of 10)', 'pack', 4, 6], ['Candles (pack of 6)', 'pack', 9, 12],
    ['Rubbish bags (roll of 20)', 'roll', 12, 16], ['Air freshener 300ml', 'can', 22, 28], ['Kerosene 1L', 'bottle', 18, 23], ['Torchlight', 'each', 25, 35],
    ['AA batteries (pack of 4)', 'pack', 12, 16], ['Plastic bucket 20L', 'each', 30, 40], ['Charcoal (small bag)', 'bag', 25, 32], ['Lighter', 'each', 3, 5],
  ],
  'Stationery & phone': [
    ['Exercise book 80 pages', 'each', 3, 4.5], ['Biro pens (pack of 10)', 'pack', 10, 14], ['Pencils (pack of 12)', 'pack', 8, 11], ['A4 paper (ream)', 'ream', 65, 78],
    ['Phone charger cable', 'each', 18, 25], ['Airtime card GHS 10', 'card', 9.6, 10], ['Airtime card GHS 20', 'card', 19.2, 20], ['Phone earpiece', 'each', 15, 22],
    ['Envelope (pack of 10)', 'pack', 5, 7], ['Glue stick', 'each', 4, 6],
  ],
  'Fresh & frozen': [
    ['Eggs (crate of 30)', 'crate', 68, 78], ['Eggs (half crate)', 'half crate', 35, 40], ['Frozen chicken 1kg', 'pack', 45, 54], ['Frozen fish (mackerel) 1kg', 'pack', 40, 48],
    ['Sausages 500g', 'pack', 28, 35], ['Yoghurt 500ml', 'bottle', 14, 18], ['Ice cream 1L', 'tub', 35, 44], ['Onions 1kg', 'kg', 12, 16],
    ['Tomatoes 1kg', 'kg', 14, 20], ['Pepper (fresh) 250g', 'pack', 6, 9], ['Garlic 250g', 'pack', 8, 11], ['Ginger 250g', 'pack', 6, 9],
  ],
  'Baby & health': [
    ['Baby formula 400g', 'tin', 85, 100], ['Baby cereal 400g', 'pack', 38, 46], ['Feeding bottle', 'each', 18, 25], ['Paracetamol (strip of 10)', 'strip', 2, 3],
    ['Oral rehydration salts sachet', 'sachet', 2, 3], ['Plasters (box of 20)', 'box', 8, 11], ['Vitamin C tablets (30)', 'bottle', 15, 20], ['Mentholated rub 50g', 'jar', 10, 14],
  ],
  Drinks: [
    ['Club beer 62.5cl', 'bottle', 11, 14], ['Guinness 33cl', 'bottle', 11, 14], ['Star beer 62.5cl', 'bottle', 11, 14], ['Malt drink 33cl bottle', 'bottle', 7, 9],
    ['Bitters 200ml', 'bottle', 14, 18], ['Soft drink crate (24 x 30cl)', 'crate', 105, 125], ['Tonic water 33cl', 'can', 6, 8], ['Ginger drink 50cl', 'bottle', 7, 10],
  ],
};

/** EAN-13 with a correct check digit, in the 200 in-store range. */
function ean13(n: number): string {
  const body = `200${String(n).padStart(9, '0')}`;
  const sum = [...body].reduce((t, d, i) => t + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

const cedis = (v: number) => v.toFixed(2);

export function sampleShopRows(): unknown[][] {
  const rows: unknown[][] = [['Name', 'SKU', 'Barcode', 'Category', 'Unit', 'Cost price', 'Selling price', 'Opening stock', 'Reorder level']];
  let n = 0;
  for (const [category, items] of Object.entries(CATALOGUE)) {
    const prefix = category.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
    for (const [name, unit, cost, price] of items) {
      n++;
      // Fast movers (cheap items) are stocked deeper than expensive ones; numbers are illustrative.
      const stock = price < 10 ? 60 + (n % 5) * 20 : price < 50 ? 18 + (n % 4) * 6 : 4 + (n % 3) * 3;
      rows.push([name, `${prefix}-${String(n).padStart(3, '0')}`, ean13(n), category, unit, cedis(cost), cedis(price), stock, Math.max(2, Math.round(stock / 4))]);
    }
  }
  return rows;
}

/** A plain guide to each template column, as a second sheet. */
export const TEMPLATE_GUIDE: unknown[][] = [
  ['Column', 'Required?', 'What to put in it', 'Example'],
  ['Name', 'Yes', 'The product name as staff and customers know it, including the size', 'Milo 400g tin'],
  ['Selling price', 'Yes', 'Price per unit in cedis. No "GHS" needed', '48.00'],
  ['SKU', 'No', 'Your own short code. Useful for items without a barcode', 'MILO-400'],
  ['Barcode', 'No', 'The number under the barcode. Scan it into the cell with a USB scanner', '6001068000012'],
  ['Category', 'No', 'Group for reports and the New sale screen. New categories are created for you', 'Beverages'],
  ['Unit', 'No', 'How you sell it: each, tin, bag, bottle, pack. Defaults to each', 'tin'],
  ['Cost price', 'No', 'What one unit costs you. Leave empty if you fill Carton cost instead', '40.00'],
  ['Opening stock', 'No', 'How many are in the shop now, in whole units. Count them first', '24'],
  ['Reorder level', 'No', 'Mansora warns you when stock falls to this number', '6'],
  ['Carton cost', 'No', 'What a whole carton costs, if you buy by the carton', '924.00'],
  ['Units per carton', 'No', 'How many units are in that carton. Mansora works out the unit cost', '24'],
  [],
  ['Tips', '', '', ''],
  ['Keep one product per row and one header row at the top. Delete the example row before importing.', '', '', ''],
  ['You can also import your own spreadsheet or an export from QuickBooks or Xero: Mansora lets you match its columns.', '', '', ''],
  ['Nothing is saved until you check the preview and press Import.', '', '', ''],
];

export const SAMPLE_GUIDE: unknown[][] = [
  ['About this sample'],
  ['A made-up Ghanaian provisions shop with about 140 products, to try Mansora or to start your own list.'],
  ['Prices are examples only. Change names, prices and stock to match your shop before importing it for real.'],
  ['Barcodes in this file are test numbers (starting 200) and will not match real packs: scan your own products to replace them.'],
];
