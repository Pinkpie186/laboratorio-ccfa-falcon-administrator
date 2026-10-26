import fs from 'node:fs/promises';

let catalogPromise;
export function loadCertificationCatalog(){
  catalogPromise ||= fs.readFile(new URL('../data/certification-tracks.json',import.meta.url),'utf8').then(JSON.parse);
  return catalogPromise;
}

export async function ensureCertificationCatalog(client){
  const catalog=await loadCertificationCatalog();
  for(const item of catalog.certifications){
    const track=(await client.query(`INSERT INTO certification_tracks(code,title,short_title,description,guide_url,guide_updated_on,program_url,position,accent)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,short_title=EXCLUDED.short_title,description=EXCLUDED.description,guide_url=EXCLUDED.guide_url,guide_updated_on=EXCLUDED.guide_updated_on,program_url=EXCLUDED.program_url,position=EXCLUDED.position,accent=EXCLUDED.accent,updated_at=now() RETURNING id`,[item.code,item.title,item.shortTitle,item.description,item.guideUrl,item.guideUpdatedOn,catalog.programUrl,item.position,item.accent])).rows[0];
    for(const [position,title] of item.domains.entries())await client.query(`INSERT INTO certification_domains(certification_id,title,position) VALUES($1,$2,$3) ON CONFLICT(certification_id,title) DO UPDATE SET position=EXCLUDED.position`,[track.id,title,position+1]);
  }
  return catalog;
}

export async function mapDocumentsToCertifications(client,teamId){
  const catalog=await ensureCertificationCatalog(client);
  let mapped=0;
  for(const item of catalog.certifications){
    const certification=(await client.query('SELECT id FROM certification_tracks WHERE code=$1',[item.code])).rows[0];
    for(const mapping of item.documents){
      const result=await client.query(`INSERT INTO document_certifications(team_id,document_id,certification_id,relevance,rationale,mapping_source)
        SELECT $1,d.id,$2,$3,$4,'official_exam_guide' FROM documents d WHERE d.team_id=$1 AND (d.title ILIKE '%'||$5||'%' OR d.category ILIKE '%'||$5||'%')
        ON CONFLICT(team_id,document_id,certification_id) DO UPDATE SET relevance=EXCLUDED.relevance,rationale=EXCLUDED.rationale,updated_at=now()
        WHERE document_certifications.mapping_source='official_exam_guide'`,[teamId,certification.id,mapping.relevance,`${mapping.relevance==='essential'?'Leitura principal':'Leitura complementar'} alinhada ao escopo publicado no Exam Guide ${item.code}.`,mapping.pattern]);
      mapped+=result.rowCount;
    }
  }
  return mapped;
}
