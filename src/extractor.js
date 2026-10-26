import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';
import pdf from 'pdf-parse';
import { createWorker } from 'tesseract.js';

const normalize = value => String(value || '').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
export const chunkText = (text, size = 1800, overlap = 180) => {
  const clean = normalize(text); const chunks = [];
  for (let start = 0, ordinal = 0; start < clean.length; start += size - overlap) chunks.push({ ordinal: ordinal++, content: clean.slice(start,start+size) });
  return chunks;
};
const stripXml = xml => normalize(xml.replace(/<a:t[^>]*>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
export async function extract(buffer, filename, mimeType) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') {
    const pages=[];
    await pdf(buffer,{pagerender:async page=>{const content=await page.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});const text=normalize(content.items.map(item=>item.str).join(' '));pages.push(text);return text;}});
    return pages.flatMap((text,pageIndex)=>chunkText(text).map((chunk,index)=>({...chunk,ordinal:0,pageNumber:pageIndex+1,section:`Página ${pageIndex+1} · trecho ${index+1}`}))).map((chunk,ordinal)=>({...chunk,ordinal}));
  }
  if (ext === '.docx') { const result = await mammoth.extractRawText({ buffer }); return chunkText(result.value); }
  if (ext === '.pptx') { const zip = new AdmZip(buffer); const text = zip.getEntries().filter(e=>/ppt\/slides\/slide\d+\.xml$/.test(e.entryName)).map((e,i)=>`Slide ${i+1}\n${stripXml(e.getData().toString('utf8'))}`).join('\n\n'); return chunkText(text); }
  if (['.txt','.md','.csv','.html','.htm'].includes(ext)) { const value = buffer.toString('utf8'); const text = ext.startsWith('.htm') ? sanitizeHtml(value,{allowedTags:[],allowedAttributes:{}}) : value; return chunkText(text); }
  if ((mimeType || '').startsWith('image/')) { const worker = await createWorker('por'); try { const result = await worker.recognize(buffer); return chunkText(result.data.text); } finally { await worker.terminate(); } }
  throw new Error('Formato não suportado.');
}
