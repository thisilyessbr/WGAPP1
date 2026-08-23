import * as pdfParseModule from 'pdf-parse';

function createPdfBuffer(title: string, bodyText: string): Buffer {
  const safeTitle = title.replace(/[()\\]/g, '');
  
  // Wrap text to max 60 chars per line
  const lines: string[] = [];
  const words = bodyText.replace(/[()\\]/g, '').split(/\s+/);
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 60) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);

  let y = 750;
  let streamContent = `BT /F1 16 Tf 50 ${y} Td (${safeTitle}) Tj ET\n`;
  y -= 30;
  for (const line of lines) {
    streamContent += `BT /F1 12 Tf 50 ${y} Td (${line}) Tj ET\n`;
    y -= 20;
  }
  const streamLen = Buffer.byteLength(streamContent, 'utf-8');

  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}endstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const header = `%PDF-1.4\n`;
  const offset1 = Buffer.byteLength(header, 'utf-8');
  const offset2 = offset1 + Buffer.byteLength(obj1, 'utf-8');
  const offset3 = offset2 + Buffer.byteLength(obj2, 'utf-8');
  const offset4 = offset3 + Buffer.byteLength(obj3, 'utf-8');
  const offset5 = offset4 + Buffer.byteLength(obj4, 'utf-8');
  const xrefOffset = offset5 + Buffer.byteLength(obj5, 'utf-8');

  const pad = (n: number) => String(n).padStart(10, '0');
  const xref = `xref\n0 6\n0000000000 65535 f \n${pad(offset1)} 00000 n \n${pad(offset2)} 00000 n \n${pad(offset3)} 00000 n \n${pad(offset4)} 00000 n \n${pad(offset5)} 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const pdfStr = header + obj1 + obj2 + obj3 + obj4 + obj5 + xref;
  return Buffer.from(pdfStr, 'utf-8');
}

async function main() {
  const buf = createPdfBuffer(
    'AnimeVerse Shipping Returns and Order Tracking Policy',
    'Shipping Policy: Standard delivery across Morocco is 30 MAD and takes 24 to 48 hours. Returns Policy: You can exchange or return any unworn merchandise including the Moon Ninja Hoodie within 14 days of delivery. Tracking: Track your order status using the SMS tracking link sent upon order dispatch.'
  );

  const pdfParse: any = (pdfParseModule as any).default || pdfParseModule;
  if (typeof pdfParse === 'function') {
    const res = await pdfParse(buf);
    console.log('EXTRACTED (v1):', res.text);
  } else if (pdfParse && pdfParse.PDFParse) {
    const uint8Array = new Uint8Array(buf);
    const parser = new pdfParse.PDFParse(uint8Array);
    await parser.load();
    const textResult = await parser.getText();
    console.log('EXTRACTED (v2):\n' + (typeof textResult === 'string' ? textResult : textResult.text));
  }
}

main().catch(console.error);
