# Stock, purchases, suppliers and expenses

For owners and managers. Each task below says where to go in Mansora and what happens to your stock and money.

## How stock changes

Stock is never typed over. Every change has a reason and is kept in **Stock → Stock movements**:

| What happened | Where | Stock | Cost |
|---|---|---|---|
| Goods arrived from a supplier | **Purchases & suppliers → Receive stock** | Goes up | Average cost updated |
| A sale | **New sale** | Goes down | Cost of the sale recorded for profit |
| A refund with the item put back | **Sales history → Refund** | Goes up | |
| Damaged, expired or stolen items | **Stock → Adjust → Damaged, expired or lost** | Goes down, with a reason | |
| A correction (miscount, wrong receipt) | **Stock → Adjust → Correction of a mistake** | Up or down, with a reason | |
| A physical count | **Stock → Stock count** | Set to what you counted | Difference recorded |

## Suppliers

**Purchases & suppliers → Suppliers → Add supplier.** Keep:
- **Name** and **Phone**;
- **Mobile Money number**, so you can pay them;
- **Location** (for example "Makola Market, Accra");
- **What they supply** (for example "Rice, oil, tinned tomatoes");
- **Notes**, such as delivery days or credit terms.

Open a supplier to see how many times you have bought from them, when you last did, and the products you usually buy from them.
Owners and managers who can see costs also see the total bought.

## Restocking

1. **Know what to order.** Open **Purchases & suppliers → Needs reordering**. It lists every product at or below its
   reorder level, grouped by the supplier you last bought it from, with a suggested quantity
   (enough to bring stock back to twice the reorder level).
   Press **Export** or **Print** to send the list to the supplier on WhatsApp or paper.
2. **Set reorder levels** under **Products**. A product with reorder level 0 is never listed. The dashboard also warns when stock runs low.
3. **When the goods arrive**, receive them (below). Check the delivery against the supplier's invoice first.

## Receiving a purchase

**Purchases & suppliers → Receive stock.**
1. Choose the **Supplier** (or "No supplier").
2. Type the supplier's invoice or delivery note number in **Reference**.
3. Add each product with the **quantity** received and the **unit cost** (what one unit cost you, not the carton).
   Buying by the carton? Divide the carton price by the units in it, or set carton costs on the product.
4. Save. Stock goes up straight away and the product's **average cost** is updated, so profit reports stay right.

You need the **Record purchases** and **View cost prices** permissions. A received purchase cannot be edited; if you made a mistake,
use **Stock → Adjust → Correction of a mistake** with a reason.

Paying suppliers on credit (what you owe each supplier) is planned (task C63). For now, keep supplier debts in your book.

## Expenses

**Expenses → Record expense.** For running costs that are not stock: rent, electricity, water, transport, salaries,
airtime and data, repairs and supplies.
1. Choose the **category**, describe it, and enter the **amount** and **date**.
2. Choose how it was paid: cash, Mobile Money, card or bank transfer.
3. If the cash came **out of the till**, tick **Paid with cash from my till** (cash only). You need an open shift, and the shift's expected cash goes down by that amount,
   so the till still balances at closing.
4. Add the receipt number if there is one, and keep the paper receipt.

Expenses appear in **Reports → Expenses** and are kept apart from the cost of goods, so gross profit is not reduced by rent or bills.

**Do not record stock purchases as expenses.** Use Receive stock, or your stock and profit will be wrong.

## Bank and Mobile Money statements

**Bank & MoMo statements** checks your money against your bank or Mobile Money wallet, and records money out as expenses without retyping.

1. In your bank's internet banking or your Mobile Money app, download a statement as **Excel or CSV**.
2. In Mansora choose **Statement from** (Mobile Money or Bank), optionally name the account, and choose the file.
3. Check **Match your columns**. Mansora usually recognises them. It needs the date, and either one amount column
   (with a minus or a Type column for money out) or separate money in and money out columns. Press **Import**.
4. Each line gets a suggestion:
   - **Matches Sale R-…** or **Matches debt repayment**: money in that matches a sale or repayment you recorded,
     by its transaction ID, or by the same amount and date;
   - **Record as an expense**: money out, with a category guessed from the description (ECG → Electricity, airtime → Airtime & data, charges → Bank charges…);
   - **Already recorded**: money out you already entered as an expense;
   - **Payment to supplier**: not an expense. Stock you bought is recorded under **Purchases & suppliers → Receive stock**.
     If it really was an expense, choose a category for that line;
   - **Already in an earlier statement**: skipped, so nothing is ever recorded twice.
5. Press **Accept all suggested** to accept every line with a clear suggestion at once, or tick lines and press
   **Accept selected**, or **Accept** on a single line. You can change the category of any money-out line first.
   Lines you do not want to record: tick them and press **Ignore selected**.

Importing the same file twice is refused. Statements stay on this laptop; the expenses they create sync as usual.

## Paying Mansora

When you pay a Mansora invoice, the payment appears in your **Expenses** automatically after the next sync,
as **Mansora subscription**, with the receipt number. It is never added twice.

## Stock counts

Count at least once a month, and whenever something looks wrong.
1. **Stock → Stock count.** Count each shelf. Type the number you counted, or scan each item: every scan adds one.
2. Leave products you did not count empty. Only the ones you fill in are changed.
3. Add a note (for example "Month-end count") and save. Differences are recorded as stock movements.

## Who can do what

| Task | Owner | Manager | Cashier |
|---|---|---|---|
| Add suppliers, receive stock | Yes | Yes | No |
| See costs and totals bought | Yes | Yes | No |
| Adjust stock, stock counts | Yes | Yes | No |
| Record expenses | Yes | Yes | No |

The owner can change this person by person on the **Staff** page. See [who-can-do-what.md](who-can-do-what.md).
