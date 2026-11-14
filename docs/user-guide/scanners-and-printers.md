# Scanning barcodes and connecting a scanner or printer

This guide is for owners and managers setting up a till, and for cashiers using one.

## Three ways to scan

| Way | Best for | What you need |
|---|---|---|
| **USB or Bluetooth barcode scanner** | Busy tills. Fastest and most reliable | A scanner that works as a "keyboard" (almost all do). About GHS 300–800 |
| **Phone or tablet camera** | Small shops, stock counts on the shop floor, adding products | Any phone with a camera and Chrome or Safari |
| **Laptop webcam** | Occasional use | A webcam. Slower; hold the item steady |

### How scanning works

A barcode scanner reads the number under the barcode (for example `6001068000012`) and types it, followed by Enter.
Mansora looks up the product with that barcode, or that SKU, and adds it to the sale. Scanning the same item again adds one more.
If nothing matches, Mansora says "No product found" and nothing is added.

## Where you can scan

| Screen | What a scan does |
|---|---|
| **New sale** | Adds the item to the basket. Click **Camera** next to the search box to use the phone camera. The camera stays open so you can scan item after item; press **Done** when finished |
| **Products** | Finds the product. In a product's details, click in **Barcode** and scan to save the item's barcode, or click **Camera** |
| **Stock → Stock count** | Every scan adds one to that product's count. Scan everything on a shelf and the count fills itself in. Check the numbers before you save |

## Set up a USB scanner (Windows laptop or any computer)

1. Plug the scanner into a USB port. Windows installs it by itself; there is nothing to download.
2. Open Notepad and scan any barcode. The number should appear, and the cursor should jump to a new line.
   - If no new line appears, the scanner is not sending **Enter**. Scan the "Add CR suffix" or "Enter suffix" barcode in the scanner's manual.
   - If letters look wrong (for example `é` instead of `2`), set the scanner to the **US keyboard** layout from its manual.
3. In Mansora, open **New sale**, click in the search box, and scan. The item is added.

A Bluetooth scanner works the same way after you pair it in **Settings → Bluetooth** on the laptop, phone or tablet.
Use it in "HID" or "keyboard" mode (see its manual).

## Use the phone camera

1. Open your shop's Mansora web address in **Chrome** (Android) or **Safari** (iPhone) and sign in.
2. Go to **New sale** (or Products, or Stock count) and press **Camera**.
3. The first time, your phone asks to use the camera. Choose **Allow**.
4. Hold the barcode flat, in good light, about a hand's width from the camera, with the red line across it. The phone buzzes when it reads the code.

**If the camera does not open**
- "Camera access was refused": open the browser's settings for this site and allow the camera, then press **Camera** again.
  In Chrome: tap the icon to the left of the web address → Permissions → Camera → Allow.
  On iPhone: Settings → Safari → Camera → Allow, or Ask.
- The site must be opened over **https://** (your shop's normal address is). The camera does not work on plain http.
- Shiny or curved packs (tins, bottles) scan better when you tilt them slightly to avoid glare.

Nothing from the camera is sent anywhere: the picture is read on the phone and only the number is used.

## Products without a barcode

Give the product a short **SKU** (for example `RICE-5KG`) and type it, or choose the product from the list on the New sale screen.
Printing barcode labels for these products is planned (board task C57b).

## Receipt printers

Mansora prints receipts for **80 mm thermal paper**, the standard roll in Ghanaian shops.

**Recommended:** an 80 mm USB thermal receipt printer that has a Windows driver (Epson TM-T20 series, Xprinter XP-80 series, or similar).
A cash drawer that plugs into the printer's "DK" port opens when the printer is told to.

### Set up a receipt printer (Windows)

1. Install the printer's Windows driver from the maker's website, then plug it in.
2. In Windows **Settings → Bluetooth & devices → Printers**, open the printer, choose **Printing preferences**, and set the paper to **80 mm × receipt** (or "Roll paper 80 × 297 mm").
3. Print a Windows test page to check it works.
4. In Mansora, finish a sale and press **Print receipt**. The print window opens: choose the receipt printer, set **Margins: None** and **Scale: 100%**, and tick **Remember** if offered.
   Your browser remembers the printer for next time.

### Browser version (today)

The browser shows its print window for every receipt. That is a browser safety rule. To make it quicker:
- Make the receipt printer the **default printer** in Windows, so you only press **Print** (or Enter).
- In Chrome on a dedicated till you can start Chrome with the `--kiosk-printing` option, which prints straight to the default printer
  without the window. Ask Mansora to set this up; use it only on a till that is not used for anything else.

### Offline Windows till (coming later)

The offline till will print receipts without the print window and open the cash drawer by itself (board tasks C48 and C49).
This is part of the offline phase and will be tested with real printers and drawers before release.

### Printing on a phone

Android phones can print to a Bluetooth thermal printer through a printing app (for example "RawBT") that adds the printer to Android's print menu.
Results vary by printer; for daily use, a laptop with a USB printer is more reliable. Customers can also get their receipt by WhatsApp:
open the sale in **Sales history** and choose **Share on WhatsApp**.

## A4 printers

Reports, invoices and customer statements print on any normal A4 printer. Choose it in the print window.

## Checklist for a new till

- [ ] Scanner types the number and Enter into Notepad
- [ ] Scanning on **New sale** adds the item
- [ ] Receipt prints on 80 mm paper with nothing cut off on the right
- [ ] Receipt printer is the Windows default printer
- [ ] Cash drawer opens (if connected), or staff know to open it with its key
- [ ] Phone camera scanning works on the manager's phone, for stock counts
