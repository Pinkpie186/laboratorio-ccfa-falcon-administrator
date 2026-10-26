import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=await fs.readFile(path.resolve(project,'../outputs/laboratorio-crowdstrike-administrator.html'),'utf8');
const domainSource=html.slice(html.indexOf('const DOMAINS='),html.indexOf('const q='));
const questionSource=html.slice(html.indexOf('const QUESTIONS='),html.indexOf('\nconst lab='));
const data=Function(`${domainSource}\nconst q=(id,domain,difficulty,prompt,options,answer,explanation,source="exam")=>({id:"q"+id,domain,difficulty,prompt,options,answer,explanation,source});${questionSource};return QUESTIONS;`)();
await fs.writeFile(path.join(project,'seed/questions.json'),JSON.stringify(data,null,2)+'\n');
console.log(`exportadas ${data.length} questões originais para revisão editorial`);
