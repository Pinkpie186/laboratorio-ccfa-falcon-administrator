const origin=process.env.APP_ORIGIN||'http://127.0.0.1:8080';

async function session(email,password){
  const response=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
  if(!response.ok)throw new Error(`login ${email}: ${response.status}`);
  const body=await response.json(),cookie=response.headers.get('set-cookie')?.split(';')[0];
  return{cookie,csrf:body.csrf};
}
async function request(path,session,options={}){
  const response=await fetch(`${origin}${path}`,{...options,headers:{cookie:session.cookie,...(options.method&&!['GET','HEAD'].includes(options.method)?{'x-csrf-token':session.csrf,'content-type':'application/json'}:{}),...options.headers}});
  const body=(response.headers.get('content-type')||'').includes('json')?await response.json():await response.text();
  return{status:response.status,body};
}

if(!process.env.DEMO_REVIEWER_PASSWORD||!process.env.DEMO_MANAGER_PASSWORD)throw new Error('Defina DEMO_REVIEWER_PASSWORD e DEMO_MANAGER_PASSWORD no ambiente privado.');
const reviewer=await session('revisor.demo@example.invalid',process.env.DEMO_REVIEWER_PASSWORD);
const manager=await session('gerente.demo@example.invalid',process.env.DEMO_MANAGER_PASSWORD);
const checks=[];
checks.push(['cadastro público bloqueado',(await fetch(`${origin}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status===403]);
checks.push(['perfil do revisor',(await request('/api/v2/profile',reviewer)).status===200]);
const documents=await request('/api/library/documents?scope=all',reviewer);
checks.push(['documentações visíveis',documents.status===200&&documents.body.length>0]);
let pdfAlternative=null;
for(const summaryDocument of documents.body.filter(item=>/(markdown|resumo)/i.test(item.title))){
  const candidate=await request(`/api/library/documents/${summaryDocument.id}/pdf-alternative`,reviewer);
  if(candidate.body?.id){pdfAlternative=candidate;break;}
}
checks.push(['resumo abre PDF baixado',Boolean(pdfAlternative?.body?.id)]);
const analytics=await request('/api/v2/analytics/me?certification=CCFA',reviewer);
checks.push(['painel separado por certificação',analytics.status===200]);
checks.push(['todos os domínios CCFA aparecem',analytics.body.domains?.length>=8]);
checks.push(['painel principal responde',(await request('/api/dashboard/student',reviewer)).status===200]);
checks.push(['revisor vê usuários',(await request('/api/v2/admin/users',reviewer)).status===200]);
checks.push(['revisor tem acesso total à fila de aprovação',(await request('/api/v2/admin/simulation-approvals?status=pending',reviewer)).status===200]);
checks.push(['gerente vê fila de aprovação',(await request('/api/v2/admin/simulation-approvals?status=pending',manager)).status===200]);
checks.push(['gerente vê usuários',(await request('/api/v2/admin/users',manager)).status===200]);
const ranking=await request('/api/v2/ranking?period=overall',reviewer),team=await request('/api/v2/admin/users',reviewer);
checks.push(['ranking mostra toda a equipe',ranking.body.rows?.length===team.body.length]);
checks.push(['sugestões disponíveis ao revisor',(await request('/api/v2/question-suggestions',reviewer)).status===200]);
checks.push(['gestor não sincroniza documentos',(await request('/api/library/sync',manager,{method:'POST',body:JSON.stringify({scope:'all'})})).status===403]);
checks.push(['gestor não aprova questões',(await request('/api/v2/questions/bulk-review',manager,{method:'POST',body:JSON.stringify({ids:[],decision:'published'})})).status===403]);
for(const [name,ok] of checks)console.log(`${ok?'OK':'FALHA'} ${name}`);
if(checks.some(([,ok])=>!ok))process.exitCode=1;
