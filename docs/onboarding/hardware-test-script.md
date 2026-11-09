# Hardware test script

Run on the actual laptop, scanner and printer to be used. Record model numbers,
date, tester and result, and keep a printed receipt as evidence. Until a model
passes, it is not "supported".

Laptop: ____________  Windows version: ______  RAM: ____  Screen: __________
Scanner model: ____________   Printer model: ____________

## Scanner (USB, keyboard-emulation mode, Enter suffix enabled)

| # | Action | Expected | Result |
| --- | --- | --- | --- |
| S1 | On New sale, scan a registered product | Product added once at the right price | |
| S2 | Scan 10 different products quickly | 10 lines, none missing, none merged | |
| S3 | Scan the same product 5 times | Quantity 5 | |
| S4 | Scan an unknown barcode | "No product found" message; basket unchanged | |
| S5 | In Products → Add product, click Barcode and scan | Barcode fills the field; form is not submitted early | |
| S6 | Scan while the payment window is open | Nothing is added to the basket | |

## Receipt printer (80 mm thermal, installed as a Windows printer)

| # | Action | Expected | Result |
| --- | --- | --- | --- |
| P1 | Complete a sale, Print receipt | Prints business name, receipt number, date, cashier, items, totals, payment, change | |
| P2 | Check the edges | Nothing cut off on the right; totals readable | |
| P3 | Sale with 30 lines | Whole receipt prints | |
| P4 | Turn the printer off, complete a sale, print | Error shown; sale is saved; reprint works after power on | |
| P5 | Sales history → Reprint | Marked "Reprinted copy" | |
| P6 | Save PDF | PDF opens and matches | |
| P7 | Disconnect internet and repeat P1 | Prints | |

## Laptop

| # | Action | Expected | Result |
| --- | --- | --- | --- |
| L1 | Use every screen at 1366 × 768 | No controls off-screen | |
| L2 | Complete a sale using only the keyboard (F2, scan, F9, amount, Enter, Enter) | Works | |
| L3 | Pull the power cable mid-sale (battery removed if possible), restart | Earlier sales intact; the interrupted one absent or complete, never partial | |
| L4 | 100 sales offline, restart, reconnect | All sync; counts match the dashboard | |
