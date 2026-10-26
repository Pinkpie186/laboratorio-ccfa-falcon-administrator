import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse';
import { PGlite } from '@electric-sql/pglite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.resolve(projectRoot, '..');
const relativePdf = 'output/ccfa/CCFA_60_questoes_com_gabarito.pdf';
const pdfPath = path.join(docsRoot, relativePdf);
const markdownPath = pdfPath.replace(/\.pdf$/i, '.md');
const apply = process.argv.includes('--apply');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const normalize = text => String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function parseQuestions(markdown, pdfText) {
  const md = markdown.replace(/\r\n/g, '\n');
  const headings = [...md.matchAll(/^### Questão (\d{2})\s*$/gm)];
  const pdfBlocks = [...pdfText.matchAll(/QUESTÃO\s+(\d{2})\s*\|([\s\S]*?)(?=QUESTÃO\s+\d{2}\s*\||GABARITO RÁPIDO|$)/g)];
  if (headings.length !== 60 || pdfBlocks.length !== 60) throw new Error(`Esperadas 60 questões em cada arquivo; Markdown=${headings.length}, PDF=${pdfBlocks.length}.`);
  const pdfByNumber = new Map(pdfBlocks.map(match => [Number(match[1]), match[2]]));
  const result = headings.map((heading, index) => {
    const number = Number(heading[1]);
    const end = headings[index + 1]?.index ?? md.indexOf('## Gabarito rápido');
    const block = md.slice(heading.index + heading[0].length, end);
    const optionStart = block.indexOf('- **A)**');
    const prompt = block.slice(0, optionStart).trim();
    const options = [...block.matchAll(/^- \*\*([A-D])\)\*\* (.+)$/gm)];
    const answer = block.match(/^\*\*Resposta: ([A-D])\.\*\* (.+)$/m);
    const reference = block.match(/^\*Referência: (.+?)\*\.?$/m);
    const domains = [...md.slice(0, heading.index).matchAll(/^## (.+)$/gm)];
    const category = domains.at(-1)?.[1]?.trim();
    const pdfBlock = pdfByNumber.get(number);
    if (number !== index + 1 || optionStart < 0 || !prompt || options.length !== 4 ||
        options.some((option, i) => option[1] !== 'ABCD'[i]) || !answer || !reference || !category || !pdfBlock) {
      throw new Error(`Estrutura incompleta ou ordem incorreta na questão ${number}.`);
    }
    const pdfAnswer = pdfBlock.match(/Resposta:\s*([A-D])\./);
    if (pdfAnswer?.[1] !== answer[1] || !normalize(pdfBlock).includes(normalize(prompt).slice(0, 55))) {
      throw new Error(`O PDF e o Markdown divergem na questão ${number}.`);
    }
    const page = Math.floor((number - 1) / 3) + 2;
    return {
      number, page, category, prompt, options: options.map(option => option[2].trim()),
      correctIndex: 'ABCD'.indexOf(answer[1]), explanation: answer[2].trim(),
      reference: reference[1].trim()
    };
  });
  if (new Set(result.map(question => normalize(question.prompt))).size !== 60) throw new Error('Enunciados duplicados no material.');
  return result;
}

function officialDomain(question) {
  if (question.number <= 6) return 'User Management';
  if (question.number <= 14) return 'Sensor Deployment';
  if (question.number <= 20) return 'Host Management and Setup';
  if (question.number <= 24) return 'Group Creation';
  if (question.number <= 40) return 'Policy Application';
  if (question.number <= 52) return 'Rule Configuration';
  if (question.number <= 56) return 'Dashboards and Reports';
  return 'Workflows';
}

const [pdfBytes, markdown] = await Promise.all([fs.readFile(pdfPath), fs.readFile(markdownPath, 'utf8')]);
const pdf = await pdfParse(pdfBytes);
if (pdf.numpages !== 23) throw new Error(`A paginação esperada mudou: ${pdf.numpages} páginas.`);
const questions = parseQuestions(markdown, pdf.text);
const sha = digest(pdfBytes);
const counts = Object.fromEntries([...new Set(questions.map(q => q.category))].map(category => [category, questions.filter(q => q.category === category).length]));
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', pdfSha256: sha, pages: pdf.numpages, questions: questions.length, alternatives: questions.reduce((n, q) => n + q.options.length, 0), categories: counts }, null, 2));
if (!apply) process.exit(0);

const db = await PGlite.create(path.join(projectRoot, 'storage', 'local-postgres'));
let committed = false;
try {
  await db.query('BEGIN');
  const teams = (await db.query('SELECT id FROM teams ORDER BY created_at')).rows;
  if (teams.length !== 1) throw new Error(`Importação local requer exatamente uma equipe; encontradas ${teams.length}.`);
  const teamId = teams[0].id;
  await db.query("SELECT set_config('app.team_id',$1,true)", [teamId]);
  const reviewer = (await db.query("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.team_id=$1 JOIN roles r ON r.id=m.role_id WHERE u.email='revisor.demo@example.invalid' AND r.code='admin_reviewer'", [teamId])).rows[0];
  if (!reviewer) throw new Error('Conta Revisor Demo não encontrada nesta equipe. Nenhuma alteração foi feita.');
  const certification = (await db.query("SELECT id FROM certification_tracks WHERE code='CCFA'")).rows[0];
  if (!certification) throw new Error('Trilha CCFA não encontrada. Nenhuma alteração foi feita.');

  let version = (await db.query('SELECT id,document_id FROM document_versions WHERE sha256=$1 AND document_id IN (SELECT id FROM documents WHERE team_id=$2)', [sha, teamId])).rows[0];
  let documentId = version?.document_id;
  if (!documentId) {
    let document = (await db.query('SELECT id FROM documents WHERE team_id=$1 AND local_path=$2', [teamId, relativePdf])).rows[0];
    if (!document) document = (await db.query(`INSERT INTO documents(
      team_id,title,category,product,language,source_kind,access_mode,source_type,local_path,
      is_public,requires_authentication,storage_permission,content_status,summary,ccfa_relevant,
      origin_confirmed,content_available,created_by,library_visibility
    ) VALUES($1,$2,'Questões de estudo','Falcon Administrator','pt-BR','authorized_import','restricted',
      'downloaded_internal',$3,false,true,'internal_authorized','available',$4,true,true,true,$5,'team_all')
    RETURNING id`, [teamId, 'CCFA — 60 cenários com gabarito comentado', relativePdf,
      'Material autoral fornecido pela usuária. Não é prova oficial nem dump; respostas citam a página do PDF.', reviewer.id])).rows[0];
    documentId = document.id;
    const storageKey = `teams/${teamId}/documents/ccfa-60-${sha.slice(0, 16)}`;
    const privatePath = path.join(projectRoot, 'storage', 'private', storageKey);
    await fs.mkdir(path.dirname(privatePath), { recursive: true });
    await fs.writeFile(privatePath, pdfBytes, { mode: 0o600 });
    version = (await db.query(`INSERT INTO document_versions(
      document_id,version_label,sha256,mime_type,byte_size,storage_key,extraction_status,
      metadata,source_consulted_at
    ) VALUES($1,'edição 2026-09-25',$2,'application/pdf',$3,$4,'completed',$5,now()) RETURNING id,document_id`,
      [documentId, sha, pdfBytes.length, storageKey, JSON.stringify({ originalPath: relativePdf, independentStudyMaterial: true, official: false })])).rows[0];
    await db.query('UPDATE documents SET current_version_id=$1,content_available=true WHERE id=$2', [version.id, documentId]);
    await db.query(`INSERT INTO document_history(team_id,document_id,version_id,action,details)
      VALUES($1,$2,$3,'imported',$4)`, [teamId, documentId, version.id, JSON.stringify({ reason: 'Substituição de banco de questões solicitada pela usuária', sha256: sha })]);
  }
  await db.query(`INSERT INTO document_certifications(team_id,document_id,certification_id,relevance,rationale,mapping_source)
    VALUES($1,$2,$3,'supporting','Material independente de questões para a trilha CCFA.','user_provided')
    ON CONFLICT(team_id,document_id,certification_id) DO NOTHING`, [teamId, documentId, certification.id]);

  for (const q of questions) {
    await db.query(`INSERT INTO document_chunks(version_id,ordinal,page_number,section,content)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(version_id,ordinal) DO NOTHING`,
      [version.id, q.number, q.page, q.category,
        `${q.prompt}\n${q.options.map((option, index) => `${'ABCD'[index]}. ${option}`).join('\n')}\nResposta: ${'ABCD'[q.correctIndex]}. ${q.explanation}\nReferência: ${q.reference}`]);
  }

  let inserted = 0;
  for (const q of questions) {
    const code = `CCFA-PDF-${sha.slice(0, 8)}-${String(q.number).padStart(3, '0')}`;
    let row = (await db.query('SELECT id FROM questions WHERE team_id=$1 AND question_code=$2', [teamId, code])).rows[0];
    if (row) continue; // Never overwrite a reviewed question or its dates on re-import.
    row = (await db.query(`INSERT INTO questions(
      team_id,author_id,question_code,category,subcategory,difficulty,format,objective,competency,
      prompt,options,correct_answer,correct_count,explanation,status,generated_by_ai,
      revalidate,approved_by,approved_at,reviewer_id,reviewed_at,official_domain,
      official_subobjective,tags,content_fingerprint,normalized_text_hash
    ) VALUES($1,$2,$3,$4,$5,'intermediária','administrative_scenario','Preparação CCFA',
      'Decisão administrativa em cenário',$6,$7,$8,1,$9,'published',false,false,$2,now(),$2,now(),
      $10,$11,$12,$13,$14) RETURNING id`, [teamId, reviewer.id, code, q.category, q.reference,
        q.prompt, JSON.stringify(q.options), JSON.stringify(q.correctIndex), q.explanation,
        officialDomain(q), q.reference, JSON.stringify(['CCFA', 'cenário', 'material independente']),
        digest(`${q.prompt}\n${q.options.join('\n')}`), digest(normalize(q.prompt))])).rows[0];
    const source = `urn:falcon-certification-lab:ccfa-60:${sha}`;
    await db.query(`INSERT INTO question_sources(
      question_id,version_id,source_url,section,page_number,excerpt,source_type,source_title,
      source_version,relative_path,consulted_at,validation_status
    ) VALUES($1,$2,$3,$4,$5,$6,'downloaded_internal',$7,$8,$9,now(),'validated_content')`,
      [row.id, version.id, source, q.category, q.page, q.prompt,
        'CCFA — 60 cenários com gabarito comentado', `sha256:${sha.slice(0, 16)}`, relativePdf]);
    await db.query(`INSERT INTO question_certifications(team_id,question_id,certification_id,mapping_source)
      VALUES($1,$2,$3,'user_approved_pdf')`, [teamId, row.id, certification.id]);
    for (let i = 0; i < 4; i++) await db.query(`INSERT INTO question_options(
      question_id,language,option_index,option_text,is_correct,explanation
    ) VALUES($1,'pt-BR',$2,$3,$4,$5)`, [row.id, i, q.options[i], i === q.correctIndex, i === q.correctIndex ? q.explanation : '']);
    await db.query(`INSERT INTO question_versions(question_id,version,snapshot,change_reason,created_by)
      VALUES($1,1,$2,'Importação de PDF aprovado pela usuária',$3)`,
      [row.id, JSON.stringify({ prompt: q.prompt, options: q.options, correctAnswer: q.correctIndex, explanation: q.explanation, category: q.category, sourcePage: q.page }), reviewer.id]);
    await db.query(`INSERT INTO reviews(team_id,question_id,reviewer_id,decision,comment)
      VALUES($1,$2,$3,'published',$4)`, [teamId, row.id, reviewer.id,
        'Publicação solicitada pela usuária a partir do PDF fornecido; material independente, não oficial.']);
    inserted++;
  }

  const retired = (await db.query(`UPDATE questions q SET status='archived',updated_at=now()
    WHERE q.team_id=$1 AND q.status<>'archived'
      AND (q.question_code IS NULL OR q.question_code NOT LIKE $2)
      AND (q.objective='Preparação CCFA' OR EXISTS(
        SELECT 1 FROM question_certifications qc WHERE qc.question_id=q.id AND qc.certification_id=$3
      )) RETURNING id`, [teamId, `CCFA-PDF-${sha.slice(0, 8)}-%`, certification.id])).rows.length;
  const countsAfter = (await db.query(`SELECT status,count(*)::int n FROM questions
    WHERE team_id=$1 GROUP BY status ORDER BY status`, [teamId])).rows;
  const eligible = (await db.query(`SELECT count(*)::int n FROM questions q JOIN question_certifications qc ON qc.question_id=q.id
    WHERE q.team_id=$1 AND qc.certification_id=$2 AND q.status='published'
      AND EXISTS(SELECT 1 FROM question_sources qs WHERE qs.question_id=q.id AND qs.validation_status='validated_content')`,
    [teamId, certification.id])).rows[0].n;
  if (eligible !== 60) throw new Error(`Validação final falhou: ${eligible} questões elegíveis para CCFA, esperado 60.`);
  await db.query('COMMIT'); committed = true;
  console.log(JSON.stringify({ imported: inserted, retired, eligibleForCcfa: eligible, databaseStatuses: countsAfter, documentId }, null, 2));
} catch (error) {
  if (!committed) await db.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await db.close();
}
