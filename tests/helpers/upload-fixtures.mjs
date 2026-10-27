// Generated synthetic bytes only; no local user files or provider calls.
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
export const imageFixture=async(format='png',width=16,height=12)=>sharp({create:{width,height,channels:3,background:'#ffffff'}})[format]().toBuffer();
export function pdfFixture(pages=['text'],extra='',streamOptions={}) {
  const objects=['<< /Type /Catalog /Pages 2 0 R '+extra+' >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const ids=[];
  for(const kind of pages){
    const pageId=objects.length+1,streamId=pageId+1,imageId=pageId+2;ids.push(pageId);
    const scan=kind==='scan'||kind==='ambiguous';
    const content=(kind!=='scan'?'BT /F1 12 Tf 50 200 Td (Synthetic fixture text) Tj ET\n':'')+(scan?`q 100 0 0 50 20 20 cm /Im1 Do Q\n`:'');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> ${scan?`/XObject << /Im1 ${imageId} 0 R >>`:''} >> /Contents ${streamId} 0 R >>`);
    const stream=streamOptions.encode?streamOptions.encode(Buffer.from(content,'latin1')):Buffer.from(content,'latin1');
    objects.push(`<< /Length ${stream.length} ${streamOptions.dictionary??''} >>\nstream\n${stream.toString('latin1')}\nendstream`);
    if(scan){const bytes=deflateSync(Buffer.alloc(20*10*3,255));objects.push(`<< /Type /XObject /Subtype /Image /Width 20 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${bytes.length} >>\nstream\n${bytes.toString('latin1')}\nendstream`);}
  }
  objects[1]=`<< /Type /Pages /Count ${ids.length} /Kids [${ids.map(id=>`${id} 0 R`).join(' ')}] >>`;
  let raw='%PDF-1.7\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(raw,'latin1'));raw+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const offset=Buffer.byteLength(raw,'latin1');raw+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(n=>raw+=`${String(n).padStart(10,'0')} 00000 n \n`);
  raw+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return Buffer.from(raw,'latin1');
}
