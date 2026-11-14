# Moving to Mansora from Excel, QuickBooks or Xero

You bring your **product list** across in one go: names, barcodes, prices, costs and how many you have.
It takes about 30 minutes for a shop with a few hundred products. Nothing is saved until you check the preview.

Where: **Import & export** (owner or manager with import permission).

## Before you start

1. **Count your stock** the evening before, or first thing in the morning before selling. The quantities you import become
   your opening stock.
2. Decide your **move-over day**. From that day, sell only in Mansora. Keep your old system for reading old records.

## Option 1: you have nothing yet, or a messy list

1. Press **Download Excel template**. It has a **How to fill this in** sheet that explains every column.
2. Fill one row per product. Only **Name** and **Selling price** are required.
3. Want to see a finished example first? Press **Download sample shop**: about 140 products of a Ghanaian provisions shop.
   You can also import it into a test shop to try Mansora out.

## Option 2: from your own Excel sheet

Use the sheet you already have. Column names do not need to match: Mansora guesses, and you can correct its guess.
- One product per row, with one header row at the top. Remove totals rows and blank rows in the middle.
- Prices can be `48`, `48.00`, `1,250.00` or `GHS 48`.
- Quantities must be whole numbers.

## Option 3: from QuickBooks

**QuickBooks Online:** go to **Sales → Products and services**, then the **Export** icon → **Export to Excel**.
**QuickBooks Desktop:** go to **Lists → Item List → Excel → Export all items**.

Open the file and delete rows that are **Service** or **Non-inventory** items you do not sell over the counter. Save it.
Mansora recognises QuickBooks columns: *Product/Service Name*, *SKU*, *Sales Price / Rate*, *Purchase Cost*, *Qty On Hand*, *Reorder Point*.

## Option 4: from Xero

Go to **Business → Products and services**, then **Export** → **Export to CSV**.
Mansora recognises Xero columns: *ItemCode* (as SKU), *ItemName*, *SalesUnitPrice*, *PurchasesUnitPrice*, and *QuantityOnHand* if your file has it.
If your Xero items do not track stock, add an **Opening stock** column and fill it from your count.

## Import

1. Press **Choose import file** and pick your file (.xlsx or .csv).
2. Check **Match your columns**. Mansora needs at least the product name and the selling price.
3. Read the preview:
   - **Will be added**: fine.
   - **Already exist**: a product with the same barcode, SKU or name is in Mansora already. It is skipped, never doubled.
   - **Errors**: fix those rows in your file, save, and choose it again.
4. Tick **I confirm the opening stock quantities are what is physically in the shop**, then press **Import**.

Importing the same file twice does nothing the second time, so it is safe to retry.

## After the import

- **Barcodes:** scan a few products on **New sale** to check they are found. Products without a barcode can be given one
  from **Products** by scanning into the Barcode box.
- **Customers who owe you:** add each customer under **Customers**. Importing balances they already owe is not available yet (planned, task C60b);
  until then, keep your old debt book for those balances and record all new credit in Mansora.
- **Suppliers:** add them under **Purchases & suppliers → Suppliers**.
- **Staff:** add each person under **Staff**, each with their own login.
- **Old sales:** past sales and invoices stay in your old system. Mansora starts its reports from your move-over day.

## Need help?

Open **Contact Mansora** and send us your file by WhatsApp or email. We will check it before you import.
