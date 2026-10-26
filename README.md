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
| **Feedbacks** | Abas de **pendentes** (por operador ou prioridade) e **aplicados** (histórico com filtros e exportação). **Contestações** da supervisão com resposta da Qualidade. |
| **Carteiras PAN** | **Veículos**, **Cartões** (apartado em *Clean Curto* e *Clean Longo*) e **Consignado** (apartado em *Público* e *Privado*), cada um com seu roteiro. Painel com tabela por produto e segmento, aderência ao roteiro (mesma conta dos dashboards PAN) e alertas de qualidade (sigilo, conduta, oferta de E.A./refin perdida, postura, sem proposta). |
| **Dashboards & reports** | Visão geral, comparativo entre quinzenas, comparativo por produto (ou pelos segmentos de um produto) e individual do operador — **com capa**, páginas A4 paisagem, impressão em PDF e download em HTML. |
| **Admin** | Quinzenas e **links das pastas de áudio do OneDrive** (por quinzena, por atendimento ou em lote, editáveis a qualquer momento), critérios e pesos, usuários e perfis, bugs reportados, auditoria, configurações da IA, backup em JSON. |
| **Reportar bug** | Botão flutuante em todas as telas (com print opcional). O admin trata e o usuário é notificado. |
| **Atalho PX** | Em *Meu perfil › Atalho na área de trabalho*: gera o instalador do atalho **PX Monitorias** com o ícone PX (Windows) ou instala como aplicativo (PWA). |

### Perfis de acesso
- **Administrador** — tudo, inclusive links de áudio, quinzenas, critérios, usuários e configurações. **É o único com acesso à análise por IA** (rodar, ver sugestões e o parecer da IA).
- **Qualidade** — altera análises, aplica feedbacks, responde contestações, importa monitorias e gera reports. Não vê nem usa a IA.
- **Supervisão** — visualiza indicadores, atendimentos e análises (pode ser restrita à própria equipe) e **solicita contestação** de uma monitoria. Não aplica feedback nem altera análises.

### Contestação de monitoria
No card do atendimento, a supervisão clica em **Contestar monitoria**, explica o motivo e marca (se quiser) os itens contestados. A Qualidade é notificada, revisa e **aceita** (ajustando os itens na aba Análise) ou **recusa**, sempre com resposta — que volta como notificação para quem contestou. Uma contestação aberta por monitoria; tudo fica no histórico do card e na tela **Contestações**.

### Regra de nota
Conforme = 100% do peso · Parcial = 50% · Não conforme = 0 · N/A sai da base. Critério **crítico** em “Não conforme” zera a nota.

## Como funciona (sem servidor próprio)

| Parte | Onde roda |
|---|---|
| **Telas** (HTML/CSS/JS da pasta `public/`) | **GitHub Pages** — grátis, sempre online, atualiza sozinho a cada mudança na `main` |
| **Banco de dados** (tabelas `px_*`) | **Supabase Postgres** |
| **Login** (e-mail corporativo + senha, “esqueci minha senha”) | **Supabase Auth** |
| **Regras, permissões e IA** (API) | **Supabase Edge Function `px-api`** (`supabase/functions/px-api`) |
| **Tempo real** | **Supabase Realtime** — quando alguém ajusta uma análise, aplica um feedback ou importa monitorias, as telas abertas se atualizam sozinhas em ~1 s |

Segurança: o navegador só tem a chave **publicável** (pública por definição). As tabelas `px_*` têm RLS ligado e nenhuma
policy para `anon`/`authenticated`, então nada pode ser lido ou gravado direto pelo navegador. Tudo passa pela Edge Function,
que valida o JWT do usuário com `@supabase/server` e aplica as permissões de cada perfil. O prefixo `px_` permite que a plataforma
conviva no mesmo projeto com o simulador de negociação.

## Publicar (passo a passo)

**1. Banco** — no Supabase, abra *SQL Editor › New query* e rode, em ordem, os arquivos de `supabase/migrations/`
(`20261024150000_px_monitorias.sql` e `20261026120000_px_realtime_seed.sql`). Os dois podem ser rodados mais de uma vez.
Se o Chrome mostrar erro de “extensão de navegador”, desative a tradução automática para supabase.com.

**2. Primeiro administrador**
- Se seu e-mail ainda não tem conta no projeto: *Authentication › Users › Add user › Create new user*, com e-mail e senha, marcando *Auto Confirm User*.
- Depois, no SQL Editor: `select public.px_bootstrap_admin('seu.email@paschoalotto.com.br', 'Seu Nome');`
  (se o e-mail já for usado no simulador, rode só este comando — a senha continua a mesma).

**3. Login** — em *Authentication › URL Configuration*:
- **Site URL**: `https://gasalomao12-cyber.github.io/Painel-de-monitorias-e-an-lises-Pan/`
- **Redirect URLs**: adicione `https://gasalomao12-cyber.github.io/**` (cobre a página `redefinir-senha.html` do “esqueci minha senha”)

Recomendado: SMTP próprio em *Authentication › Emails › SMTP Settings* (o envio padrão do Supabase tem limite baixo por hora).

**4. API (Edge Function)** — publicada automaticamente pelo GitHub Actions:
- Gere um token em supabase.com › *Account › Access Tokens*.
- No GitHub: *Settings › Secrets and variables › Actions › New repository secret* → `SUPABASE_ACCESS_TOKEN`.
- (Opcional) `SUPABASE_DB_PASSWORD` para que as migrações novas também sejam aplicadas sozinhas.
- Em *Actions › Publicar API (Supabase) › Run workflow* para a primeira publicação. Depois, toda mudança em `supabase/` na `main` publica sozinha.
- Sem GitHub Actions: `npx supabase functions deploy px-api --project-ref avhlvnuspaaacuitvjdd`.

**5. Telas (GitHub Pages)** — com o repositório público: *Settings › Pages › Build and deployment › Source: GitHub Actions*.
Rode *Actions › Publicar telas (GitHub Pages) › Run workflow*. Endereço final:
`https://gasalomao12-cyber.github.io/Painel-de-monitorias-e-an-lises-Pan/`

**6. IA (opcional)** — cadastre a chave da Anthropic em *Configurações › Inteligência artificial* na própria plataforma,
ou como segredo da Edge Function (*Edge Functions › Secrets* › `ANTHROPIC_API_KEY`). Sem chave, a análise usa uma heurística local apenas como sugestão.

**7. Atalho PX** — em *Meu perfil › Atalho na área de trabalho*, cada pessoa baixa o instalador do atalho com o ícone PX (Windows)
ou instala como aplicativo (Chrome/Edge).

## Tela em qualquer resolução
- **Escala automática**: a interface inteira cresce ou encolhe conforme a resolução, mantendo o mesmo layout
  (notebook 1366×768 ≈ 89%, Full HD ≈ 110–126%, monitores grandes até 135%).
- **Botão de zoom** na barra superior: 80% a 130% ou automático; a escolha fica salva no computador.
- **Menu lateral** recolhe sozinho em ícones em notebooks (janela com menos de 1600 px); a escolha manual é lembrada por tipo de tela.
- Em celular e tablet o layout responsivo assume (menu em gaveta).

## Desenvolvimento local
```bash
npm install && npm run vendor          # copia as bibliotecas do navegador para public/vendor
npx supabase start                     # banco, Auth, Realtime e Edge Functions locais (Docker)
npx serve public -l 4173               # telas em http://127.0.0.1:4173
```
Para apontar as telas para o Supabase local, no console do navegador:
`localStorage.setItem('px_dev_config', JSON.stringify({ supabaseUrl: 'http://127.0.0.1:54321', publishableKey: '<chave publicável local>' }))`.
Dados fictícios para conhecer a plataforma: *Configurações › Dados › Carregar demonstração* (cria usuários fictícios **sem acesso**).

## Transcrição de áudio (Azure Speech)
O admin envia o áudio da ligação (.wav, .mp3…) no card do atendimento (**Transcrever áudio**) ou em lote na tela **Análise com IA**. O Azure Speech transcreve em português, separando operador e cliente, e a IA analisa em seguida. Áudios cujo nome traz o ID da ligação (padrão do discador) são vinculados sozinhos à monitoria já importada.

Para ativar:
1. No portal da Azure, crie um recurso **Speech** (Serviços de IA › Speech), de preferência na região do Brasil (*Brazil South*) ou na que a TI indicar.
2. Em *Chaves e Ponto de Extremidade*, copie a **Chave 1** e a **Região**.
3. Na plataforma, em *Configurações › Transcrição de áudio*, cole a região e a chave, salve e clique em **Testar conexão**.
   (Alternativa: `supabase secrets set AZURE_SPEECH_KEY=... AZURE_SPEECH_ENDPOINT=brazilsouth`.)

O áudio vai do servidor direto para o recurso da empresa e não é guardado na plataforma, só o texto. Limite de 100 MB por arquivo. A Azure cobra por hora de áudio transcrito.

## Importação dos dashboards de monitoria PAN (.html)
*Importar monitorias › Dashboard de monitoria já trabalhado*: arraste o arquivo .html do dashboard da quinzena. São reconhecidos:
- **Speech E.A. e Refin (Veículos)**: 13 itens do roteiro (postura fora da nota), ajustes de coerência com o motivo, aptidão a E.A./refin, oferta Nelson, gerência, líder, campanha, canal (AGV/convencional), tabulação, desfecho e nome do áudio.
- **Roteiro Sem Garantia (Cartões e Consignado)**: 11 itens (proposta fora da nota), ajustes da 2ª leitura, transcrição completa, resumo, ponto forte, feedback sugerido, quem atendeu, motivo, ofertas, esforço negocial, sigilo, conduta e acolhimento. O segmento vem do Capacity: *Clean Curto/Clean Longo* nos cartões, *Público* (Empréstimo Consignado) ou *Privado* (Empréstimo Privado) no consignado. Quando o Capacity não traz o segmento, a ligação entra como *Segmento a definir* e pode ser ajustada no card.

Só o bloco de dados do arquivo é lido, no navegador, e enviado à API em lotes. Operadores são cadastrados pelo login, a quinzena é encontrada (ou criada) pelas datas e ligações já importadas são ignoradas, então reenviar o arquivo não duplica nada. **Os arquivos têm dados de clientes: não suba os .html para o repositório.**

## Importação da planilha do speech
*Importar monitorias › Modelo .xlsx*: uma linha por atendimento (operador, matrícula, equipe, supervisor, produto, data, protocolo, contrato, cliente, duração, nota speech, link áudio, resumo) e uma coluna por critério pelo **código** (ex.: `IDT`, `RCE`, `ESD`) com C/P/NC/NA — também aceita Sim/Não/Parcial. Colunas `OBS <código>` viram a observação do speech. Operadores novos são cadastrados automaticamente.

## Estrutura
```
supabase/ migrations/ (tabelas px_*, views, segurança, tempo real) · functions/px-api/ (API: rotas, IA, permissões)
.github/  workflows/ (publicação automática das telas e da API)
public/   index.html (SPA), report.html (dashboards), redefinir-senha.html, config.js, css/, js/, vendor/, icons/ (PX)
desktop/  atalho do Windows (alternativo) e ícone PX
```
