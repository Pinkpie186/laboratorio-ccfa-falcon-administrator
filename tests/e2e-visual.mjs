import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const { chromium }=require('playwright');
const baseUrl=process.env.APP_URL||'http://localhost:8080';
const chromePath=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const output=path.resolve('test-artifacts','screenshots');
await fs.mkdir(output,{recursive:true});
const reviewerPassword=process.env.DEMO_REVIEWER_PASSWORD;
if(!reviewerPassword)throw new Error('Defina DEMO_REVIEWER_PASSWORD no ambiente privado para executar o teste E2E.');

const login=await fetch(`${baseUrl}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'revisor.demo@example.invalid',password:reviewerPassword})});
assert.equal(login.status,200,'login de teste indisponível');
const auth=await login.json(),cookie=login.headers.get('set-cookie')?.split(';')[0];
const certifications=await (await fetch(`${baseUrl}/api/certifications`,{headers:{cookie}})).json();
const originalActive=certifications.find(x=>x.is_active),ccfa=certifications.find(x=>x.code==='CCFA');
assert.ok(ccfa,'CCFA não cadastrada');
async function selectCertification(row){
  const response=await fetch(`${baseUrl}/api/certifications/${row.code}/progress`,{method:'PUT',headers:{cookie,'x-csrf-token':auth.csrf,'content-type':'application/json'},body:JSON.stringify({status:row.status,percent:Number(row.percent),isActive:true})});
  assert.equal(response.status,200,`não foi possível selecionar ${row.code}`);
}
if(originalActive?.code!=='CCFA')await selectCertification(ccfa);

const browser=await chromium.launch({headless:true,executablePath:chromePath});
const consoleErrors=[];

try{
  for(const viewport of [
    {name:'desktop',width:1440,height:900},
    {name:'tablet',width:768,height:1024},
    {name:'mobile',width:360,height:800}
  ]){
    const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
    const page=await context.newPage();
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.locator('#loginForm').getByLabel('E-mail').fill('revisor.demo@example.invalid');
    await page.locator('#loginForm').getByLabel('Senha').fill(reviewerPassword);
    await page.locator('#loginForm button[type="submit"]').click();
    await page.waitForSelector('#appShell:not([hidden])');
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(`${viewport.name}: ${message.text()}`);});
    page.on('pageerror',error=>consoleErrors.push(`${viewport.name}: ${error.message}`));
    await page.goto(`${baseUrl}/#calendar`,{waitUntil:'networkidle'});
    await page.waitForSelector('#calendarEvents .calendar-event');

    const overflow=await page.evaluate(()=>({
      viewport:document.documentElement.clientWidth,
      document:document.documentElement.scrollWidth,
      body:document.body.scrollWidth,
      offenders:[...document.querySelectorAll('body *')].map(element=>{
        const box=element.getBoundingClientRect();
        return{tag:element.tagName,id:element.id,className:String(element.className||''),left:Math.round(box.left),right:Math.round(box.right),width:Math.round(box.width)};
      }).filter(item=>item.right>document.documentElement.clientWidth+1||item.left<-1).slice(0,12)
    }));
    assert.ok(overflow.document<=overflow.viewport+1,`${viewport.name}: documento com rolagem horizontal (${overflow.document}/${overflow.viewport}) ${JSON.stringify(overflow.offenders)}`);
    assert.ok(overflow.body<=overflow.viewport+1,`${viewport.name}: body com rolagem horizontal (${overflow.body}/${overflow.viewport})`);

    await page.screenshot({path:path.join(output,`calendar-${viewport.name}.png`),fullPage:false});
    for(const label of ['Semana','Dia','Agenda','Pendências']){
      await page.getByRole('button',{name:label,exact:true}).click();
      await page.waitForTimeout(120);
      assert.ok(await page.locator('#calendarEvents').isVisible(),`${viewport.name}: visão ${label} não está visível`);
    }
    await page.getByRole('button',{name:'Mês',exact:true}).click();
    const firstEvent=page.locator('#calendarEvents .calendar-event').first();
    await firstEvent.click();
    await page.waitForSelector('#sessionDrawer[open]');
    assert.ok(await page.getByText('Mover ou redimensionar').isVisible(),`${viewport.name}: controles de movimentação ausentes`);
    await page.getByRole('button',{name:'Fechar'}).click();
    await page.goto(`${baseUrl}/#goals`,{waitUntil:'networkidle'});
    assert.ok((await page.locator('#goalCurrent .goal-deadline strong').innerText()).length>5,`${viewport.name}: data final ausente`);
    await page.screenshot({path:path.join(output,`goals-${viewport.name}.png`),fullPage:false});
    await page.goto(`${baseUrl}/#documents`,{waitUntil:'networkidle'});
    await page.locator('[data-doc-scope="guides"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('#documents .library-card').length===8);
    assert.equal(await page.locator('#documents .library-card').count(),8,`${viewport.name}: Study Guides incorretos`);
    await context.close();
  }
  assert.deepEqual(consoleErrors,[],`Erros no console: ${consoleErrors.join(' | ')}`);
  console.log(JSON.stringify({ok:true,viewports:['1440x900','768x1024','360x800'],views:['month','week','day','agenda','pending'],screenshots:output},null,2));
}finally{
  if(originalActive&&originalActive.code!=='CCFA')await selectCertification(originalActive);
  await browser.close();
}
