# PX Monitorias & Feedbacks · Paschoalotto

Plataforma web (servidor na nuvem) para publicar os reports quinzenais de qualidade de **Refinanciamento** e **Entrega Amigável**: monitorias auditadas, ajuste da análise do speech, análise de transcrições com IA, registro de feedbacks e geração de dashboards com capa.

## O que a plataforma faz

| Área | Recursos |
|---|---|
| **Login e boas-vindas** | Login por e-mail corporativo (Supabase Auth), “esqueci minha senha”, troca de senha obrigatória no 1º acesso, tela de boas-vindas onde a pessoa diz **como gostaria de ser chamada** e escolhe o tema (escuro/claro). |
| **Painel** | KPIs (nota média, conformidade, monitorias, % de feedback, falhas críticas, análises corrigidas), insights automáticos, **evolução por quinzena**, **dispersão speech × nota final**, **mapa de desempenho** (média × consistência), distribuição de notas, critérios ofensores, ranking com tendência. |
| **Atendimentos** | Um card por monitoria com nota, speech × final, status, falha crítica, ajustes e link do áudio. **Card verde = feedback aplicado.** Filtros, busca, lista/grade, exportação Excel. |
| **Card detalhado** | **Ajuste de análise** por critério (Conforme / Parcial / Não conforme / N/A) com motivo obrigatório e recálculo da nota ao vivo; parecer da IA com evidências; transcrição com busca; **aplicação de feedback** (o que foi passado, pontos fortes, melhorias, plano de ação, ciência do operador, reavaliação); histórico completo. |
| **Análise com IA** | Anexe transcrições (.txt, .docx, .vtt, .srt, .json), em lote. A IA (Claude) avalia cada critério com o trecho da fala, **corrige sozinha o que o speech interpretou errado** (confiança alta) e sugere o feedback. Ajustes manuais nunca são sobrescritos. Sem chave, roda uma heurística local apenas como sugestão. |
| **Feedbacks** | Abas de **pendentes** (por operador ou prioridade) e **aplicados** (histórico com filtros e exportação). |
| **Dashboards & reports** | Visão geral, comparativo entre quinzenas, Refin × Entrega e individual do operador — **com capa**, páginas A4 paisagem, impressão em PDF e download em HTML. |
| **Admin** | Quinzenas e **links das pastas de áudio do OneDrive** (por quinzena, por atendimento ou em lote, editáveis a qualquer momento), critérios e pesos, usuários e perfis, bugs reportados, auditoria, configurações da IA, backup em JSON. |
| **Reportar bug** | Botão flutuante em todas as telas (com print opcional). O admin trata e o usuário é notificado. |
| **Atalho PX** | Em *Meu perfil › Atalho na área de trabalho*: gera o instalador do atalho **PX Monitorias** com o ícone PX (Windows) ou instala como aplicativo (PWA). |

### Perfis de acesso
- **Administrador** — tudo, inclusive links de áudio, quinzenas, critérios, usuários e configurações.
- **Qualidade** — importa monitorias, ajusta análises, usa a IA, aplica feedbacks, gera reports.
- **Supervisão** — consulta atendimentos e gráficos, aplica e registra feedbacks (pode ser restrita à própria equipe).

### Regra de nota
Conforme = 100% do peso · Parcial = 50% · Não conforme = 0 · N/A sai da base. Critério **crítico** em “Não conforme” zera a nota.

## Banco de dados e login: Supabase

Os dados ficam no **Postgres do Supabase** e o login usa o **Supabase Auth** (e-mail corporativo + senha).
O navegador nunca fala direto com o banco: o servidor Node acessa as tabelas `px_*` com a chave secreta,
e cada requisição tem o JWT do usuário verificado com `@supabase/server` (JWKS do projeto).
As tabelas ficam com RLS ligado e sem policies para `anon`/`authenticated`, então a chave publicável não lê nada.
O prefixo `px_` permite que a plataforma conviva no mesmo projeto com o simulador de negociação.

### 1. Criar as tabelas
No Supabase: **SQL Editor › New query**, cole o conteúdo de `supabase/migrations/20261024150000_px_monitorias.sql` e clique em **Run**.
(Com a CLI: `supabase link --project-ref avhlvnuspaaacuitvjdd` e `supabase db push`.) O script pode ser executado mais de uma vez.

### 2. Configurar o Auth
Em **Authentication › URL Configuration**:
- **Site URL**: o endereço público da plataforma (ex.: `https://px-monitorias.onrender.com`).
- **Redirect URLs**: adicione `https://SEU-ENDERECO/redefinir-senha` — sem isso o link de “Esqueci minha senha” não volta para a plataforma.

Recomendado: configure um **SMTP próprio** em *Authentication › Emails › SMTP Settings* (o envio padrão do Supabase tem limite baixo de e-mails por hora).
Se o projeto for usado só por esta plataforma, desative *Allow new users to sign up* — os acessos são criados pelo administrador.

### 3. Variáveis de ambiente
Copie `.env.example` para `.env` (ou cadastre no serviço de hospedagem):

| Variável | Para quê |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWKS_URL` | Projeto Supabase (já preenchidos no exemplo) |
| `SUPABASE_SECRET_KEY` | Chave secreta (*Project Settings › API Keys*). **Somente no servidor.** |
| `PUBLIC_URL` | Endereço público, usado no link de recuperação de senha |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Primeiro administrador (criado só se não houver nenhum) |
| `ANTHROPIC_API_KEY` | IA de análise de transcrições (opcional) |
| `SEED_DEMO` | `true` carrega dados fictícios de demonstração |

### 4. Rodar
Requisitos: **Node.js 20+**.

```bash
npm install
npm start          # http://localhost:3000
```

No primeiro start a plataforma cria os critérios padrão e o administrador de `ADMIN_EMAIL`
(troca de senha obrigatória no 1º acesso). Se esse e-mail já tiver conta no projeto (ex.: no simulador),
a conta é reaproveitada e a pessoa entra com a senha que já usa.

### Acessos
- O admin cria os acessos em **Usuários & acessos** informando nome, **e-mail corporativo** e perfil; a plataforma gera uma senha temporária.
- “Esqueci minha senha” envia o link de recuperação pelo Supabase; o admin também pode gerar nova senha temporária.
- Desativar um acesso bloqueia o login no Supabase Auth e derruba a sessão na hora.

### Publicar na nuvem
- **Render**: crie um *Blueprint* com este repositório (`render.yaml`) e preencha `SUPABASE_SECRET_KEY`, `PUBLIC_URL`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`. Não precisa de disco: os dados ficam no Supabase.
- **Docker** (Railway, Fly.io, Azure, VM): `docker build -t px-monitorias . && docker run -p 3000:3000 --env-file .env px-monitorias`.
- Use HTTPS (necessário para instalar como app e para os cookies seguros de sessão).

### Ativar a IA
Crie uma chave em console.anthropic.com e defina `ANTHROPIC_API_KEY` no servidor (ou cadastre em *Configurações › Inteligência artificial*). Modelo padrão: Claude Opus 5.5, com fallback automático do servidor em caso de recusa.

### Atalho na área de trabalho
- Pela plataforma: *Meu perfil › Atalho para Windows* baixa um `.bat` que já sabe o endereço do servidor.
- Pela pasta `desktop/`: `Criar atalho PX Monitorias.bat` pede o endereço e cria o atalho com `px.ico`.

## Importação da planilha do speech
*Importar monitorias › Modelo .xlsx*: uma linha por atendimento (operador, matrícula, equipe, supervisor, produto, data, protocolo, contrato, cliente, duração, nota speech, link áudio, resumo) e uma coluna por critério pelo **código** (ex.: `IDT`, `RCE`, `ESD`) com C/P/NC/NA — também aceita Sim/Não/Parcial. Colunas `OBS <código>` viram a observação do speech. Operadores novos são cadastrados automaticamente.

## Estrutura
```
server/   index.js (HTTP), routes.js (API), supa.js (clientes Supabase), auth.js (Supabase Auth), db.js (config/auditoria), ai.js (Claude + heurística), io.js (planilhas/transcrições), scoring.js, seed.js
supabase/ migrations/ (tabelas px_*, views e segurança)
public/   index.html (SPA), report.html (dashboards), css/, js/ (app, views, charts), icons/ (PX)
desktop/  atalho do Windows e ícone PX
```
