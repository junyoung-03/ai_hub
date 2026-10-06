// Generated non-sensitive test notice for exactly one browser upload + Gemini analysis.
import {writeFileSync,mkdirSync} from 'node:fs';
const lines=['SYNTHETIC BACKEND GAP TEST - NO PERSONAL DATA',
 'You must submit the sample application form by October 15, 2026.',
 'Required document: sample application form.',
 'This request applies to participants of the synthetic test only.',
 'The information session is on October 20, 2026. This is not a submission deadline.'];
const stream=lines.map((line,i)=>`BT /F1 12 Tf 30 ${750-i*28} Td (${line}) Tj ET`).join('\n');
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
mkdirSync('supabase/.temp/gap-fixtures',{recursive:true});writeFileSync('supabase/.temp/gap-fixtures/synthetic-backend-gap.pdf',pdf);
console.log('PASS: one synthetic test PDF prepared; no personal data or provider request.');
