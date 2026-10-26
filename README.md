# Falcon Admin Platform

Aplicação full-stack multiusuário para treinamento interno de CrowdStrike Falcon Administrator. A nova aplicação fica isolada em `falcon-admin-platform/`; o HTML offline original foi preservado em `outputs/` e teve o plano fixo de sete dias removido.

## O que está incluído

- API Node/Express, PostgreSQL 16 e migração versionada;
- sessões opacas em cookie HTTP-only, bcrypt, CSRF, rate limiting, CSP/Helmet e RBAC;
- papéis Analista, Gestor e Administrador/Revisor, equipes e isolamento por `team_id` + RLS;
- armazenamento privado local ou S3 compatível (MinIO/R2/S3), sem credenciais no frontend;
- importação PDF, DOCX, PPTX, TXT, Markdown, CSV, HTML e imagens/OCR;
- deduplicação SHA-256, versionamento, trechos pesquisáveis e citações por versão/seção/página;
- fluxo editorial rascunho → revisão → aprovação → publicação → arquivamento;
- simulados rápidos, por domínio, adaptativos e completos (60/90), com seed/versão e sem repetição;
- 12 cursos oficiais, 72 questões originais importadas para **fila de revisão** e 20 labs seguros;
- calendário retroativo/adaptativo, histórico preservado, revisão 1/3/7/14/30 e `.ics`;
- PWA responsiva, claro/escuro, cache offline sem credenciais;
- worker assíncrono para extração/OCR e relatórios PDF/CSV;
- auditoria append-only, dashboards e critérios internos de prontidão.

Não há conteúdo copiado de dumps. O link de terceiro é somente referência, rotulado como não oficial e não validado. Questões da base editorial só podem ser publicadas com fonte documental.

## Início rápido com Docker (Windows ou Linux)

Pré-requisitos: Git, Docker Desktop/Engine e Docker Compose v2.

No computador Windows deste projeto, leia primeiro [`DOCKER-WSL-SEGURO.md`](./DOCKER-WSL-SEGURO.md): o diagnóstico encontrou somente 18 GB livres e o instalador protegido aborta até haver uma margem segura.

```bash
cd falcon-admin-platform
cp .env.example .env
docker compose up --build
```

No PowerShell:

```powershell
Set-Location falcon-admin-platform
powershell -ExecutionPolicy Bypass -File .\scripts\windows\init-local-env.ps1
docker compose up --build
```

Acesse `http://localhost:8080`. A conta fictícia inicial usa o e-mail abaixo e a senha aleatória `DEMO_REVIEWER_PASSWORD` guardada apenas no `.env` local:

- e-mail: `revisor.demo@example.invalid`

Troque ou remova as contas demo antes de qualquer implantação compartilhada. O `.env`, os bancos e os documentos locais não são enviados ao GitHub. Em instalações já existentes, as senhas atuais não são modificadas por esta alteração; recomenda-se trocá-las em **Meu perfil**.

Serviços:

- aplicação/API: `8080`;
- PostgreSQL: `5432` (apenas desenvolvimento local);
- MinIO: `9000`, console `9001` (opcional; o Compose usa volume privado local por padrão);
- worker assíncrono executado em processo separado.

## Execução sem Docker

Use Node.js 20+ e um PostgreSQL 16 disponível:

```bash
pnpm install
cp .env.example .env
pnpm migrate
pnpm seed
pnpm start
```

Em outro terminal:

```bash
pnpm worker
```

Mantenha `.env` fora do Git. Em produção, injete os segredos pelo gerenciador da plataforma.

## Banco e segurança

A migração `migrations/001_init.sql` cria as tabelas requeridas: equipes, usuários, papéis, associações, sessões, cursos/submódulos, documentos/versões/trechos, questões/fontes/revisões, simulados/tentativas/respostas, metas/disponibilidade/agendas/eventos, labs/evidências, progresso, prontidão, relatórios, notificações, jobs, importações e auditoria.

Proteções importantes:

- o navegador recebe somente dados necessários; senhas, tokens, CID e chaves ficam no backend/cofre;
- cookies de sessão são HTTP-only, SameSite=Strict e Secure em produção;
- toda mutação autenticada exige `x-csrf-token`;
- a API filtra a equipe e o PostgreSQL aplica RLS como defesa adicional;
- uploads têm limite/tipos permitidos, hash e storage privado;
- `audit_log` rejeita `UPDATE` e `DELETE`;
- evidências passam por sanitização/redação, mas o usuário ainda deve remover dados do tenant;
- SSO, MFA e SCIM têm pontos de configuração, sem alegar integração pronta.

Em produção, use TLS, PostgreSQL gerenciado com criptografia/backup, storage privado com SSE, rotação de segredos, WAF/rate limiting externo e múltiplas réplicas do worker.

## Importação inicial executada

Fonte consultada pela sessão autenticada do usuário: `https://docs.crowdstrike.com/p/release-notes`.

Nenhuma senha, cookie ou token foi copiado. Como não havia exportação autorizada do texto integral na interface consultada, o lote inicial foi catalogado somente com metadados e links, marcado como “Consulta no portal CrowdStrike”. O checkpoint permite continuar depois de upload/exportação autorizada.

| Métrica | Resultado |
|---|---:|
| Registros informados pelo portal | 3.221 |
| Encontrados no lote autorizado | 20 |
| Texto integral importado | 0 |
| Somente catalogados | 20 |
| Atualizados | 0 |
| Duplicatas | 0 |
| Falhas | 0 |
| Questões geradas deste lote | 0 |
| Questões aguardando revisão | 72 da base original preservada |
| Última sincronização | 17/08/2026 15:05 BRT |

Arquivos auditáveis: `data/official-catalog.json` e `data/import-report.json`. O checkpoint atual é página 1, offset 20, incompleto. Os quatro registros sem título confirmado permanecem explicitamente pendentes; nada foi inventado.

Para exibir o relatório/checkpoint:

```bash
pnpm sync:docs
```

Para uma sincronização agendada, execute o comando somente contra um catálogo/export autorizado. Exemplo semanal no cron:

```cron
0 7 * * 1 cd /opt/falcon-admin-platform && /usr/bin/pnpm sync:docs >> /var/log/falcon-doc-sync.log 2>&1
```

No Agendador de Tarefas do Windows, use `pnpm.cmd sync:docs` com o diretório do projeto. O script atual é deliberadamente conservador: mostra o checkpoint e não tenta reutilizar sessão/cookie do navegador. Continue o conteúdo integral pela aba **Documentações**, enviando arquivos exportados por usuário autorizado.

## Trilha oficial e submódulos

A estrutura dos 12 cursos e as durações vêm do Falcon Administrator Learning Plan. A sessão autenticada confirmou contagens de módulos onde disponíveis. Os nomes dos submódulos não foram inferidos: a interface permite cadastrar manualmente ou importar a partir de material autorizado. Atualizações preservam percentuais e datas históricas (`COALESCE`, `GREATEST` e revisões de agenda).

## Upload, citações e questões

1. Gestor/revisor abre **Documentações → Importar material**.
2. O backend calcula SHA-256, bloqueia duplicata e grava o arquivo no storage privado.
3. O worker extrai o texto localmente e divide em trechos pesquisáveis.
4. Questões criadas exigem `document_version`, URL, seção/página e trecho.
5. Um revisor decide aprovar/publicar; a API impede publicação sem fonte.
6. Se a versão do documento mudar, o fluxo administrativo deve marcar as questões associadas como `revalidate`.

OCR usa Tesseract local. Não envie documentos a serviços externos sem aprovação formal. `CORPORATE_AI_ENDPOINT` é apenas um ponto futuro; nenhuma geração por IA externa é feita automaticamente.

## Biblioteca unificada

A aba **Documentações** combina materiais baixados, páginas públicas oficiais e links que exigem o portal CrowdStrike. Os arquivos da pasta pai são montados no container somente para leitura; o navegador recebe apenas nomes seguros e identificadores, nunca caminhos absolutos do servidor.

Sincronização manual:

```bash
docker compose exec -T api pnpm sync:library -- --scope=all
```

Também é possível iniciar a sincronização pela interface com perfil `manager` ou `admin` e configurar periodicidade diária ou semanal. O catálogo web usa allowlist de domínios oficiais, HTTPS, bloqueio de IP privado/SSRF, limite de tamanho, retentativas curtas, `ETag`/`Last-Modified` e checkpoint incremental. Conteúdo com autenticação é somente catalogado; cookies e credenciais do portal nunca são utilizados.

O relatório reproduzível da importação inicial está em `data/library-import-report.json`. As versões internas não são substituídas por uma versão pública: correspondências ficam registradas para comparação e histórico.

## Calendário e OAuth

O plano usa data-meta, disponibilidade e ordem de pré-requisitos. Ele gera nova revisão e marca a anterior como superada, sem apagá-la. Exportação `.ics` usa `America/Sao_Paulo` e descrições sem dados sensíveis.

Google/Outlook estão em modo de prévia. Para ativar:

1. registre o app OAuth no provedor;
2. configure Client ID/Secret **somente no backend**;
3. implemente callback server-side e armazenamento criptografado do refresh token;
4. grave `sync_identifier` para idempotência;
5. mantenha a etapa de prévia e confirmação explícita antes de alterações externas.

## Testes

```bash
pnpm test
pnpm test:integration   # exige PostgreSQL migrado e duas equipes de teste
```

Cobertura automatizada atual: sorteio determinístico/sem repetição, sanitização, SHA-256, chunking, calendário adaptativo, revisão espaçada, `.ics`, contrato offline/responsivo, ausência de segredos no frontend e contagens do catálogo/banco editorial. O teste de integração cobre isolamento/RLS e imutabilidade da auditoria.

Também valide manualmente:

- cadastro/login/logout/recuperação/troca de senha;
- RBAC com contas dos três papéis e duas equipes;
- upload de cada formato, duplicata, OCR e citação;
- simulado completo com 60 questões publicadas;
- layouts em 360 px, 768 px e desktop;
- exportação PDF/CSV e download autorizado;
- prévia OAuth sem confirmar evento externo.

## Backup, restauração e atualização

Backup:

```bash
docker compose exec -T postgres pg_dump -U falcon_app -Fc falcon_admin > falcon-admin.dump
```

Copie também o volume `private_files` (ou use versionamento do bucket S3). Banco e arquivos devem ser restaurados como um conjunto consistente.

Restauração em ambiente vazio:

```bash
docker compose exec -T postgres dropdb -U falcon_app --if-exists falcon_admin
docker compose exec -T postgres createdb -U falcon_app falcon_admin
docker compose exec -T postgres pg_restore -U falcon_app -d falcon_admin --clean --if-exists < falcon-admin.dump
```

Atualização:

```bash
git pull --ff-only
docker compose build
docker compose run --rm api node scripts/migrate.js
docker compose up -d
```

Faça backup e teste restauração antes. Migrações devem ser aditivas; nunca apague progresso, materiais, submódulos ou histórico em atualização.

## Validação da correção flexível (20/08/2026)

- migrations aditivas `006_flexible_learning_and_ranking.sql` e `007_study_session_title_compatibility.sql`;
- 60 documentos, 79 versões e 19.427 trechos preservados;
- 140 questões citadas geradas em 20 categorias, todas em revisão humana (49 fáceis, 63 intermediárias e 28 difíceis);
- 72 questões legadas sem evidência continuam preservadas e bloqueadas para publicação;
- plano aplicado ao usuário demo com 28 sessões, 86 atividades e 33,8 horas, incluindo vários eventos por dia;
- simulado de prévia validado com autosave/retomada; modo completo validado com 60 IDs únicos e 90 minutos;
- calendário exercitado em mês, semana, dia, agenda e pendências, nas larguras 1440, 768 e 360 px;
- 24 testes unitários aprovados, 4 testes de integração aprovados e zero falha.

Comandos de verificação em Docker:

```bash
docker compose up -d --build
docker compose exec -T api node --test --test-reporter=spec tests/*.test.js
docker compose exec -T -e RUN_DB_TESTS=1 api node --test --test-reporter=spec tests/integration.test.js tests/platform-integration.test.js
```

O teste visual reproduzível está em `tests/e2e-visual.mjs`; ele requer Playwright e Chrome instalados e grava as capturas em `test-artifacts/screenshots/`.

## Arquitetura de produção

- frontend PWA servido pelo mesmo domínio da API;
- API/worker em containers separados;
- PostgreSQL gerenciado (Neon, RDS, Cloud SQL, Azure Database etc.);
- object storage privado com URLs assinadas curtas;
- OAuth/SSO e segredos no cofre da plataforma;
- logs centralizados com redação e retenção definida;
- backups automáticos, PITR e teste periódico de restauração.

GitHub Pages não executa backend/PostgreSQL e, portanto, serve apenas para a versão estática antiga. Para compartilhar a versão multiusuário, implante o container em Render/Fly.io/Azure/AWS/Google Cloud ou similar e conecte PostgreSQL + storage privados. Nunca publique os documentos autenticados no repositório.
