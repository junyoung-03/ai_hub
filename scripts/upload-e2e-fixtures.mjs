// Small synthetic files only; generation does not upload or invoke OCR.
import {mkdirSync,writeFileSync} from 'node:fs';
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import sharp from 'sharp';
import {pdfFixture} from './upload-fixtures.mjs';
const directory='supabase/.temp/upload3-fixtures';mkdirSync(directory,{recursive:true});
GlobalFonts.loadSystemFonts();
const canvas=createCanvas(1000,300),context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,1000,300);context.fillStyle='black';context.font='48px "Malgun Gothic", sans-serif';
context.fillText('한글 문서 테스트',40,100);context.fillText('ENGLISH DOCUMENT TEST 12345',40,210);
writeFileSync(`${directory}/synthetic-text.pdf`,pdfFixture(['text']));writeFileSync(`${directory}/synthetic-ocr.png`,canvas.toBuffer('image/png'));
const jpeg=await sharp(canvas.toBuffer('image/png')).jpeg({quality:95}).toBuffer();writeFileSync(`${directory}/synthetic-ocr.jpg`,jpeg);
function scannedPDF(mixed=false){
  const objects=[],add=value=>{objects.push(Buffer.isBuffer(value)?value:Buffer.from(value));return objects.length;};
  add('<< /Type /Catalog /Pages 2 0 R >>');add(`<< /Type /Pages /Kids [3 0 R${mixed?' 6 0 R':''}] /Count ${mixed?2:1} >>`);
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 108] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>');
  const stream=Buffer.from('q 360 0 0 108 0 0 cm /Im1 Do Q');add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),stream,Buffer.from('\nendstream')]));
  add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1000 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]));
  if(mixed){add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 108] /Resources << /Font << /F1 8 0 R >> >> /Contents 7 0 R >>');const text=Buffer.from('BT /F1 16 Tf 20 60 Td (Synthetic embedded page) Tj ET');add(Buffer.concat([Buffer.from(`<< /Length ${text.length} >>\nstream\n`),text,Buffer.from('\nendstream')]));add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');}
  const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let size=chunks[0].length;
  for(const [index,value]of objects.entries()){offsets.push(size);const chunk=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),value,Buffer.from('\nendobj\n')]);chunks.push(chunk);size+=chunk.length;}
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(v=>String(v).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`));return Buffer.concat(chunks);
}
writeFileSync(`${directory}/synthetic-scan.pdf`,scannedPDF());writeFileSync(`${directory}/synthetic-mixed.pdf`,scannedPDF(true));
console.log('PASS: synthetic text PDF, Korean/English PNG/JPEG, scanned/mixed PDF prepared; ignored directory; no upload/OCR/PII.');
