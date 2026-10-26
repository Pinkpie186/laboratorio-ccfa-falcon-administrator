import path from 'node:path';
import { z } from 'zod';
import { transaction } from './db.js';
import { ensureCertificationCatalog, mapDocumentsToCertifications } from './certifications.js';

const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const parse=(schema,value)=>{const result=schema.safeParse(value);if(!result.success){const error=new Error(result.error.issues.map(x=>x.message).join('; '));error.status=400;throw error;}return result.data;};

export function registerCertificationRoutes(app,{requireAuth,requireCsrf}){
  app.get('/api/certifications',requireAuth,route(async(req,res)=>{
    const rows=await transaction(async c=>{
      await ensureCertificationCatalog(c);await mapDocumentsToCertifications(c,req.auth.team_id);
      return (await c.query(`SELECT ct.*,
        COALESCE(ce.status,'not_started') status,COALESCE(ce.percent,0) percent,ce.target_date,COALESCE(ce.is_active,false) is_active,ce.started_at,ce.completed_at,
        (SELECT count(*) FROM certification_domains cd WHERE cd.certification_id=ct.id) domain_count,
        (SELECT count(*) FROM document_certifications dc WHERE dc.team_id=$1 AND dc.certification_id=ct.id) document_count,
        (SELECT count(*) FROM document_certifications dc WHERE dc.team_id=$1 AND dc.certification_id=ct.id AND dc.relevance='essential') essential_count,
        (SELECT count(*) FROM document_certifications dc JOIN document_reading_progress rp ON rp.document_id=dc.document_id AND rp.user_id=$2 WHERE dc.team_id=$1 AND dc.certification_id=ct.id AND rp.percent=100) read_count
        FROM certification_tracks ct LEFT JOIN certification_enrollments ce ON ce.certification_id=ct.id AND ce.user_id=$2 ORDER BY ct.position`,[req.auth.team_id,req.auth.user_id])).rows;
    },{teamId:req.auth.team_id,userId:req.auth.user_id});
    res.json(rows);
  }));

  app.get('/api/certifications/:code',requireAuth,route(async(req,res)=>{
    const code=parse(z.string().regex(/^CC[A-Z]{2}$/),req.params.code.toUpperCase());
    const result=await transaction(async c=>{
      const certification=(await c.query(`SELECT ct.*,COALESCE(ce.status,'not_started') status,COALESCE(ce.percent,0) percent,ce.target_date,COALESCE(ce.is_active,false) is_active,ce.started_at,ce.completed_at FROM certification_tracks ct LEFT JOIN certification_enrollments ce ON ce.certification_id=ct.id AND ce.user_id=$1 WHERE ct.code=$2`,[req.auth.user_id,code])).rows[0];
      if(!certification)return null;
      const domains=(await c.query('SELECT id,title,position FROM certification_domains WHERE certification_id=$1 ORDER BY position',[certification.id])).rows;
      const documents=(await c.query(`SELECT d.id,d.title,d.summary,d.category,d.source_type,d.source_url,d.local_path,d.updated_date,d.content_available,dc.relevance,dc.rationale,COALESCE(rp.percent,0) reading_percent
        FROM document_certifications dc JOIN documents d ON d.id=dc.document_id LEFT JOIN document_reading_progress rp ON rp.document_id=d.id AND rp.user_id=$1
        WHERE dc.team_id=$2 AND dc.certification_id=$3 ORDER BY CASE dc.relevance WHEN 'essential' THEN 1 ELSE 2 END,d.title`,[req.auth.user_id,req.auth.team_id,certification.id])).rows.map(row=>({...row,local_path:row.local_path?path.basename(row.local_path):null}));
      return{certification,domains,documents};
    },{teamId:req.auth.team_id,userId:req.auth.user_id});
    if(!result)return res.status(404).json({error:'Certificação não encontrada.'});res.json(result);
  }));

  app.put('/api/certifications/:code/progress',requireAuth,requireCsrf,route(async(req,res)=>{
    const code=parse(z.string().regex(/^CC[A-Z]{2}$/),req.params.code.toUpperCase());
    const body=parse(z.object({percent:z.number().min(0).max(100),status:z.enum(['not_started','in_progress','completed']),targetDate:z.string().date().nullable().optional(),isActive:z.boolean().default(false)}),req.body);
    const row=await transaction(async c=>{
      const certification=(await c.query('SELECT id FROM certification_tracks WHERE code=$1',[code])).rows[0];if(!certification){const error=new Error('Certificação não encontrada.');error.status=404;throw error;}
      if(body.isActive)await c.query('UPDATE certification_enrollments SET is_active=false,updated_at=now() WHERE user_id=$1',[req.auth.user_id]);
      return (await c.query(`INSERT INTO certification_enrollments(team_id,user_id,certification_id,status,percent,target_date,started_at,completed_at,is_active)
        VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $4<>'not_started' THEN now() END,CASE WHEN $4='completed' THEN now() END,$7)
        ON CONFLICT(user_id,certification_id) DO UPDATE SET status=EXCLUDED.status,percent=EXCLUDED.percent,target_date=COALESCE(EXCLUDED.target_date,certification_enrollments.target_date),started_at=COALESCE(certification_enrollments.started_at,EXCLUDED.started_at),completed_at=COALESCE(certification_enrollments.completed_at,EXCLUDED.completed_at),is_active=EXCLUDED.is_active,updated_at=now() RETURNING *`,[req.auth.team_id,req.auth.user_id,certification.id,body.status,body.percent,body.targetDate||null,body.isActive])).rows[0];
    },{teamId:req.auth.team_id,userId:req.auth.user_id});res.json(row);
  }));
}
