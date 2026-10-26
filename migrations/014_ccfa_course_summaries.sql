-- Resumos editoriais em português, derivados das descrições exibidas no plano
-- autenticado Falcon Administrator. Evolução aditiva: não altera progresso,
-- sessões, submódulos ou datas já registradas.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS learning_topics text[] NOT NULL DEFAULT '{}';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS summary_source_url text;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS summary_consulted_at date;

UPDATE courses SET
  summary = CASE code
    WHEN 'FALCON 100' THEN 'Apresenta a arquitetura unificada e nativa de nuvem da plataforma Falcon, seus principais módulos e como eles trabalham em conjunto para apoiar a proteção contra ameaças modernas.'
    WHEN 'FALCON 101' THEN 'Oferece uma visão guiada do console Falcon, da navegação e das aplicações centrais usadas para visibilidade, prevenção, detecção, investigação e aplicação de políticas.'
    WHEN 'FALCON 102' THEN 'Percorre o ciclo de onboarding da plataforma em ambientes corporativos: planejamento, sensores, alertas, autenticação, APIs, políticas, grupos de hosts, monitoramento e suporte operacional.'
    WHEN 'FALCON 104' THEN 'Introduz a segurança de endpoints no Falcon, mostrando como a telemetria de comportamento se transforma em detecções contextualizadas e como esse contexto inicia uma investigação.'
    WHEN 'FALCON 105' THEN 'Aborda preparação, instalação, configuração e solução de problemas do Falcon Sensor em Windows, macOS, Linux e ambientes virtuais, incluindo requisitos, opções de instalação e políticas relacionadas.'
    WHEN 'FALCON 106' THEN 'Ensina a criar e administrar dashboards personalizados, distinguindo fontes únicas e múltiplas e cobrindo edição, compartilhamento, duplicação e agendamento como relatório.'
    WHEN 'FALCON 107' THEN 'Apresenta os fundamentos do Falcon Firewall Management para administrar o firewall nativo do Windows pelo console e sensor Falcon, incluindo regras, grupos de regras e políticas.'
    WHEN 'SOAR 100' THEN 'Explica como construir, executar e acompanhar workflows no Falcon Fusion SOAR usando gatilhos, condições, ações, ramificações, loops e execução sob demanda.'
    WHEN 'FALCON 160' THEN 'Apresenta o Falcon for Mobile para Android e iOS, com foco em telemetria, privacidade, planejamento de implantação, modelos MDM e BYOD, inscrição e validação do rollout.'
    WHEN 'ITSEC 121' THEN 'Introduz o Falcon Vulnerability Management para visibilidade de vulnerabilidades sem varredura tradicional, priorização, filtros, supressões, patches, relatórios e APIs.'
    WHEN 'ITSEC 122' THEN 'Apresenta o Asset Management para obter visibilidade de ativos, contas e aplicações, usando inventários, dashboards e tabelas para navegar e analisar o ambiente.'
    WHEN 'ILT' THEN 'Direciona o aluno aos treinamentos conduzidos por instrutor que complementam a preparação de Falcon Administrator. A página do plano não informa nomes nem duração dessas turmas.'
    ELSE summary
  END,
  learning_topics = CASE code
    WHEN 'FALCON 100' THEN ARRAY['Arquitetura da plataforma Falcon','Módulos centrais','Uso integrado da plataforma']
    WHEN 'FALCON 101' THEN ARRAY['Navegação no console','Aplicações Falcon','Detecção, investigação e políticas']
    WHEN 'FALCON 102' THEN ARRAY['Planejamento e onboarding','SSO e OAuth2','Sensores, políticas e grupos','Alertas, triagem e suporte']
    WHEN 'FALCON 104' THEN ARRAY['Visibilidade de endpoint','Telemetria e comportamento','Detecções e MITRE ATT&CK','Contexto para investigação']
    WHEN 'FALCON 105' THEN ARRAY['Pré-requisitos de SO e rede','Instalação multiplataforma','Opções e scripts de instalação','Políticas e troubleshooting']
    WHEN 'FALCON 106' THEN ARRAY['Dashboards de fonte única','Dashboards multifuente','Compartilhamento e edição','Relatórios agendados']
    WHEN 'FALCON 107' THEN ARRAY['Firewall Management','Grupos de regras','Regras de firewall','Políticas de firewall']
    WHEN 'SOAR 100' THEN ARRAY['Gatilhos, condições e ações','Ramificações e loops','Execução sob demanda','Monitoramento e histórico']
    WHEN 'FALCON 160' THEN ARRAY['Proteção Android e iOS','Telemetria e privacidade','MDM e BYOD','Inscrição e validação']
    WHEN 'ITSEC 121' THEN ARRAY['Visibilidade de vulnerabilidades','Priorização e filtros','Supressões e patches','Relatórios e APIs']
    WHEN 'ITSEC 122' THEN ARRAY['Inventário de ativos','Contas e aplicações','Dashboards e tabelas','Análise do ambiente']
    WHEN 'ILT' THEN ARRAY['Treinamento conduzido por instrutor','Complemento da trilha administrativa']
    ELSE learning_topics
  END,
  summary_source_url = 'https://university.crowdstrike.com/learn/learning-plans/111/falcon-administrator',
  summary_consulted_at = DATE '2026-10-05'
WHERE code IN ('FALCON 100','FALCON 101','FALCON 102','FALCON 104','FALCON 105','FALCON 106','FALCON 107','SOAR 100','FALCON 160','ITSEC 121','ITSEC 122','ILT');

-- Module titles observed directly in each authenticated course index on
-- 2026-10-05. Only syllabus metadata is stored; no closed lesson content,
-- assessment answer, or personal account data is copied.
WITH official_modules(code, title, position) AS (VALUES
  ('FALCON 100','Falcon Platform Architecture Introduction',1),
  ('FALCON 100','Core Falcon Platform Modules',2),
  ('FALCON 100','Leveraging the Falcon Platform',3),
  ('FALCON 101','Getting Started with the Falcon Console',1),
  ('FALCON 101','Host Setup and Management',2),
  ('FALCON 101','Endpoint Security Deep-Dive',3),
  ('FALCON 101','Identity Protection and Next-Gen SIEM',4),
  ('FALCON 101','Cloud Security',5),
  ('FALCON 101','Real Time Response (RTR)',6),
  ('FALCON 101','Threat Intelligence and Charlotte AI',7),
  ('FALCON 101','Summary',8),
  ('FALCON 102','Setting up users and planning implementation',1),
  ('FALCON 102','Configuring single sign-on, alert notifications, and prevention policies',2),
  ('FALCON 102','Create sensor update policies and additional configurations',3),
  ('FALCON 102','Managing host groups for endpoint policy enforcement',4),
  ('FALCON 102','Managing false positives and exclusions',5),
  ('FALCON 102','Navigating and optimizing Falcon support resources',6),
  ('FALCON 104','Introduction to Endpoint Security',1),
  ('FALCON 104','Detection Lifestyle in Action',2),
  ('FALCON 104','Investigating Detections with Context',3),
  ('FALCON 105','Introduction and pre-installation',1),
  ('FALCON 105','Policy settings',2),
  ('FALCON 105','Windows sensor installation',3),
  ('FALCON 105','MacOS sensor installation',4),
  ('FALCON 105','Linux sensor installation',5),
  ('FALCON 105','Virtual Machine installation',6),
  ('FALCON 105','Troubleshooting and course wrap-up',7),
  ('FALCON 106','Dashboards Foundations',1),
  ('FALCON 106','Build a Dashboard',2),
  ('FALCON 106','Operationalize: Share, Report, Maintain',3),
  ('FALCON 106','Summary',4),
  ('FALCON 107','Firewall Management Fundamentals',1),
  ('FALCON 107','Firewall Rule Creation',2),
  ('SOAR 100','Introduction to Falcon Fusion SOAR',1),
  ('SOAR 100','Fusion SOAR Workflow Examples',2),
  ('SOAR 100','Monitor Workflows',3),
  ('SOAR 100','Build a Falcon Fusion SOAR Workflow',4),
  ('FALCON 160','Introduction to Falcon for Mobile',1),
  ('FALCON 160','Planning & Deploying Falcon for Mobile',2),
  ('FALCON 160','Managing Falcon for Mobile',3),
  ('ITSEC 121','Vulnerability Management Overview',1),
  ('ITSEC 121','Identifying Vulnerabilities',2),
  ('ITSEC 121','Vulnerability Management',3),
  ('ITSEC 121','Investigating Vulnerabilities',4),
  ('ITSEC 121','Prioritizing Remediation',5),
  ('ITSEC 121','Vulnerability Management Reports',6),
  ('ITSEC 121','Remediation Options: Ticketing workflows, Custom Dashboards and APIs',7),
  ('ITSEC 121','Installed Patches Monitoring',8),
  ('ITSEC 121','Vulnerability Suppression Rules and Course Summary',9),
  ('ITSEC 122','Asset Management Overview',1),
  ('ITSEC 122','Asset Management Dashboards and Tables',2),
  ('ITSEC 122','Assets',3),
  ('ITSEC 122','Accounts',4),
  ('ITSEC 122','Applications and Course Summary',5),
  ('ILT','Falcon Administrator ILT courses',1)
)
INSERT INTO submodules(course_id, title, position, source_type, notes, source_url, verified_at)
SELECT c.id, m.title, m.position, 'authorized_import',
       'Titulo confirmado no indice autenticado da CrowdStrike University em 05/10/2026.',
       'https://university.crowdstrike.com/learn/learning-plans/111/falcon-administrator',
       TIMESTAMPTZ '2026-10-05 12:00:00-03'
FROM official_modules m JOIN courses c ON c.code=m.code
ON CONFLICT (course_id,title) DO UPDATE SET
  position=EXCLUDED.position,
  source_type='authorized_import',
  notes=COALESCE(submodules.notes,EXCLUDED.notes),
  source_url=EXCLUDED.source_url,
  verified_at=COALESCE(submodules.verified_at,EXCLUDED.verified_at);

UPDATE courses c SET official_module_count=x.module_count
FROM (SELECT course_id,count(*)::integer module_count FROM submodules WHERE verified_at IS NOT NULL GROUP BY course_id) x
WHERE c.id=x.course_id;
