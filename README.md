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

## Hospedar numa VM da empresa
O guia do T.I. está em [`implantacao-vm/LEIA-ME_TI.md`](implantacao-vm/LEIA-ME_TI.md): Supabase self-hosted (Docker) + Nginx,
com a configuração do Nginx e scripts para criar o banco, apontar as telas para o domínio da VM, atualizar e fazer backup.

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

## Planilha de ações (CONTROLE DE AÇÕES no Excel online)
Cada ação feita na plataforma vira uma linha na planilha online, sem preenchimento manual. As colunas são LOGIN, SEGMENTO, TEMA, AÇÃO, DATA, OBS e RESPONSÁVEL. Entram sozinhas:

| Na plataforma | AÇÃO na planilha |
|---|---|
| Feedback aplicado | `Feedback` (presencial/telefone) ou `Feedback online` (Teams/chat) |
| Análise validada ou ajustada | `Análise` (uma linha por monitoria, pessoa e dia) |
| Análise com IA (admin) | `Análise` |
| Contestação respondida | `Calibragem` |
| Ações fora da plataforma | **Controle de ações › Registrar ação**: in loco, treinamento, simulador, reunião…, para um ou vários operadores |

Como cada coluna é preenchida:
- **LOGIN:** o login do operador.
- **SEGMENTO:** vem da carteira e do segmento da monitoria. O mapeamento pode ser editado em Configurações.
- **TEMA:** sugerido pela etapa do roteiro onde estão as falhas, e pode ser trocado no feedback.
- **RESPONSÁVEL:** o nome de quem fez a ação, em maiúsculas.

A tela **Controle de ações** mostra o histórico e o status de cada linha (na planilha, na fila ou com erro). O que falhar, por exemplo com a planilha bloqueada, é reenviado sem duplicar.

**Configuração (uma vez, com a TI):**
1. Em **Entra ID › Registros de aplicativo › Novo registro**, crie "PX Monitorias - Planilha" (contas só deste diretório).
2. Em **Permissões de API › Microsoft Graph › Permissões de aplicativo**, adicione `Files.ReadWrite.All` e clique em **Conceder consentimento do administrador**.
   - Alternativa mais restrita: `Sites.Selected`, com acesso concedido só a este arquivo/site.
3. Em **Certificados e segredos**, crie um segredo do cliente e copie o **valor**.
4. Na plataforma, em **Configurações › Planilha de ações**, preencha os campos abaixo, salve e clique em **Testar conexão**:
   - O link da planilha.
   - A tabela (`Tabela2`).
   - O **ID do diretório (tenant)** e o **ID do aplicativo (cliente)**, ambos da página do aplicativo.
   - O segredo.
   - Ligue a opção "Enviar as ações para a planilha".
   - Alternativa: `supabase secrets set MS_TENANT_ID=... MS_CLIENT_ID=... MS_CLIENT_SECRET=...`.

Linhas já enviadas não são apagadas da planilha quando o feedback é excluído; o histórico fica na planilha.

## Transcrição de áudio (Azure Speech)
O admin envia o áudio da ligação (.wav, .mp3…) no card do atendimento (**Transcrever áudio**) ou em lote na tela **Análise com IA**. O Azure Speech transcreve em português, separando operador e cliente, e a IA analisa em seguida. Áudios cujo nome traz o ID da ligação (padrão do discador) são vinculados sozinhos à monitoria já importada.

Para ativar:
1. No portal da Azure, crie um recurso **Speech** (Serviços de IA › Speech), de preferência na região do Brasil (*Brazil South*) ou na que a TI indicar.
2. Em *Chaves e Ponto de Extremidade*, copie a **Chave 1** e a **Região**.
3. Na plataforma, em *Configurações › Transcrição de áudio*, cole a região e a chave, salve e clique em **Testar conexão**.
   (Alternativa: `supabase secrets set AZURE_SPEECH_KEY=... AZURE_SPEECH_ENDPOINT=brazilsouth`.)

O áudio vai do servidor direto para o recurso da empresa e não é guardado na plataforma, só o texto. Limite de 100 MB por arquivo. A Azure cobra por hora de áudio transcrito.

## Lista de ligações do discador (.csv)
*Importar monitorias › Lista de ligações do discador*: o relatório exportado do discador (IdContato, Campanha, Operacao, Login, DataHoraLigacao, Duracao, CLIENTE, FINALIZACAO, Contrato, NomeDoArquivo, NomeOriginalDoArquivo, TIPO DE DESCONEXÃO). Também aceita .xlsx com as mesmas colunas.

- **Cada ligação vira um atendimento pendente,** com:
  - O operador pelo login (logins novos são cadastrados e o nome é completado depois).
  - A carteira pela operação: PAN VEICULOS → Veículos, PAN CARTÕES → Cartões.
  - O segmento, em Cartões e Consignado, igual ao da última monitoria do operador.
  - Tabulação, campanha, canal (AGV), duração e o nome do áudio.
- **Ligação que já existe** (por exemplo, vinda de um dashboard) só tem os campos vazios completados. Reimportar não duplica.
- **Vínculo automático depois:** o áudio ou a transcrição enviados em seguida se vinculam sozinhos à ligação, pelo ID no nome do arquivo. Vale tanto o padrão do discador (`43501102_…wav`) quanto o nome original do speech (`asp-t2-epro…_43501102.wav`).

## Análises AGV (campanhas com assistente virtual)

Menu **Análises AGV**. Reúne só as ligações das campanhas AGV (campanha com "AGV" no nome, como `APTI_PAFIXA_AGVIA`
e `APTI_PCART02IAGV`), avaliadas no **roteiro AGV**: as 9 perguntas do relatório do speech "PAN TESTE DE PERGUNTAS AGV",
olhando só o que o operador fez depois da transferência. O desfecho (acordo com boleto, promessa, retorno, sem acordo)
fica no campo desfecho da ligação.

- **Importar**: botão "Importar ligações e speech". Envie o `.csv` do discador e o `.xlsx` do relatório do speech
  juntos ou separados. O discador cria as ligações (operador pelo login, carteira pela operação). O relatório preenche as
  respostas, ligando cada uma pelo ID no nome do áudio. Quando a mesma ligação foi avaliada mais de uma vez, vale a
  avaliação mais recente.
- **Dashboards AGV (.html)**: entram pelo mesmo botão (ou em "Importar monitorias"). Há dois tipos:
  - "Teste do speech AGV" por gerência: traz a resposta do speech, a resposta revisada e o porquê de cada correção.
  - Comparativo AGV entre dois dias: traz a leitura da transcrição.

  Uma ligação que já veio do discador ou do relatório do speech é completada com a leitura revisada, nunca duplicada,
  e o relatório do speech não sobrescreve depois o que foi revisado no dashboard.
- **Regras de coerência na entrada**:
  - Sem negociação com o titular (ou quem atendeu não era o titular), as perguntas da negociação viram N/A.
  - Confirmar valor e data só cabe quando houve acordo com boleto.
  - Explicar as consequências não cabe quando houve acordo.
  - Oferecer outra condição só cabe depois de uma proposta.
  - Acordo com boleto conta como proposta feita.

  A resposta original do speech fica guardada. Cada correção aparece no card, com o motivo. O que a Qualidade
  ajustou à mão nunca é sobrescrito.
- **Comparativos**:
  - Carteira, campanha, equipe, supervisor, operador, quinzena, semana e dia, com a aderência de cada pergunta num
    mapa de calor e o desfecho das ligações.
  - Período A × período B, mostrando quanto cada pergunta subiu ou caiu.
  - Conformidade final × resposta original do speech.
  - Evolução diária.
  - AGV × Convencional na mesma carteira.
- Em **Atendimentos**, o filtro "Canal" separa AGV e Convencional.
- **Migração**: rode `supabase/migrations/20261029120000_px_agv.sql` no SQL Editor. Ela cria o roteiro AGV e passa
  para ele as ligações AGV do discador que ainda não foram avaliadas.

## Análises AGV: análise do dia, não quinzena

- **Fora das quinzenas:** ligações AGV avaliadas nos roteiros AGV não entram nas quinzenas de monitoria.
- **Agrupamento:** elas se agrupam pela **análise**, que é o período do arquivo importado (ex.: "19/10", "23 a 26/10") ou, sem ele, o dia da ligação.
- **Telas:** Análises AGV e Esforço negocial filtram e comparam por análise, dia e semana.
- **Migração:** `supabase/migrations/20261031120000_px_agv_analise_diaria.sql` tira da quinzena as ligações AGV que já estavam lá.

## Excluir análises AGV (administrador)

Na tela Análises AGV, o botão **Gerenciar análises** lista cada análise importada por roteiro (período do arquivo, ex.: "23 a 26/10", ou dia das ligações). Para cada uma mostra:
- quantidade de ligações;
- datas;
- origem;
- quantas têm transcrição ou material de feedback;
- quantas já têm feedback aplicado.

Marque as que quer tirar e exclua. Como funciona:
- **Feedback aplicado:** por padrão, as ligações que já têm feedback ficam.
- **O que sai junto:** roteiro, feedbacks e contestações da ligação.
- **Planilha de ações:** as linhas já enviadas continuam lá, sem o vínculo com a ligação.
- **Auditoria:** a exclusão fica registrada.

## Queda de ligação (força-tarefa)

Aba **Queda de ligação** no menu lateral, para analisar à mão os atendimentos tabulados como queda
(QUEDA LIGACAO CLIENTE, QUEDA DE LIGACAO…). Várias pessoas analisam ao mesmo tempo: quem abre um
atendimento o reserva por 15 minutos ("em análise por…") e os números, gráficos e cards se atualizam
sozinhos na tela de todos, mesmo com uma análise aberta.

- **Capacity**: anexe o .xlsx ou .csv do capacity. A plataforma acha sozinha a linha do cabeçalho (mesmo com
  título em cima) e reconhece as colunas pelo sentido: login (LOGIN, LOGIN OLOS, USUÁRIO…), nome (OPERADOR,
  NOME DO OPERADOR, COLABORADOR…), liderança (LIDERANÇA, SUPERVISOR(A), COORDENADOR…), gerência (GERENTE),
  campanha, segmento/carteira, situação e turno. Logins com domínio ou e-mail são limpos. A prévia mostra as
  colunas usadas e, se não reconhecer o arquivo, o que encontrou. Abas de desligados e remanejados também são
  lidas. Qualquer perfil anexa o próprio capacity; .xls antigo precisa ser salvo como .xlsx.
- **Gerência**: o capacity não traz a gerência. Ela vem dos operadores já cadastrados na plataforma e
  pode ser ajustada por liderança na janela Capacity; o ajuste vale também para os atendimentos já lançados.
- **Operador**: digite o login ou o nome completo, com ou sem acento (ou escolha na lista suspensa).
  Liderança, gerência, campanha/setor e segmento vêm sozinhos.
- **CSV de metadados (opcional)**: o CSV do discador (IdContato, Campanha, Login, DataHoraLigacao,
  Duracao, FINALIZACAO, NomeDoArquivo, TIPO DE DESCONEXÃO) vira a fila de atendimentos. Por padrão
  só entram as tabulações de queda. Telefone e CPF não são guardados.
- **Áudio e transcrição**: o botão "Pasta de áudios" abre a pasta do SharePoint (o link é salvo pela
  própria aba, só no banco). Na análise dá para colar o link do arquivo, anexar o áudio (bucket privado
  `px-quedas`, até 50 MB, ouvido por link assinado de 10 minutos) e anexar ou colar a transcrição.
- **Resultado**: cliente desligou, operador desligou, queda técnica, ligação muda, atendimento seguiu
  ou inconclusivo. "Operador desligou" é sempre desvio de conduta e gera o card do operador.
  A tabulação de queda procede só quando o cliente ou a linha derrubou a ligação.
- **Desconexão interna** é destacada nos números e na análise: a ligação foi encerrada do nosso lado,
  então confirme no áudio se o cliente realmente abandonou.
- **Permissões**: todos os perfis analisam os pendentes. Só a Qualidade e o admin alteram a análise de
  outra pessoa, trocam o capacity e a gerência. Só o admin exclui análises feitas.

**Carteiras (ex.: SAFRA)**: em Usuários & acessos, o campo **Carteira** separa quem analisa outra carteira
(vazio = PAN).
- Cada usuário anexa o próprio capacity: ele vale só para quem anexou e não muda o de outras pessoas nem o
  de outras carteiras. Quem ainda não anexou usa o capacity mais recente de alguém da mesma carteira.
- Os atendimentos importados ou lançados ficam com a carteira de quem importou. O mesmo IdContato pode
  existir em carteiras diferentes.
- O painel soma todas as carteiras para todo mundo. Cada atendimento, analista, card de desvio e liderança
  mostra a carteira, e o filtro **Carteira** separa as análises.
- Cada carteira altera só os próprios atendimentos; os das outras abrem só para consulta (o admin pode tudo).
- Gerências e pasta de áudios são por carteira. Nas carteiras fora da PAN, as próprias analistas cuidam do
  capacity, das gerências e da pasta; na PAN, continuam a Qualidade e o admin.

**Carteira analisada, visão e exportação**
- Cada análise (e cada CSV importado) informa a carteira: SAFRA BS, SAFRA ADM, PAN CONTACT, PAN MASSIFICADOS,
  PAN ATIVAS E AJUIZADOS ou PORTO. A última escolhida já vem marcada.
- O seletor **Consolidada / PAN / SAFRA / PORTO** muda todos os números, gráficos e a lista; o filtro
  **Carteira** separa uma carteira específica.
- **Exportar CSV** gera o arquivo nas colunas da planilha de controle (Nome, Login, Contrato, Telefone, Data,
  Tempo Ligação, Classificação Operador, Classificação Correta, Status Classificação, Desconexão, Prestou
  Atendimento?, Segurou Ligação?, Observação), seguidas de carteira, ID, liderança, gerência, resultado,
  desvio e analista. Dá para exportar a visão consolidada, um grupo (PAN, SAFRA, PORTO) ou uma carteira, só os
  analisados ou todos, e com ou sem os filtros da tela. O arquivo abre direto no Excel (";" e UTF-8).
- Na análise entram também Telefone, Contrato, "Prestou atendimento?" e "Segurou a ligação?".
- **Transcrições em lote**: o botão **Transcrições** recebe um documento (.docx ou .txt) com várias transcrições,
  cada uma começando pelo nome do arquivo de áudio (que traz o IdContato), e, opcionalmente, o CSV de metadados do
  discador. Cada transcrição é anexada ao atendimento do mesmo IdContato; os que não existem são criados com login,
  data, duração, finalização e tipo de desconexão do CSV (sem o CSV, login e data vêm do nome do arquivo), já com
  liderança e gerência do capacity. Importar de novo só reanexa, sem duplicar.
- **Planilha de análises de volta**: o CSV exportado (ou a planilha de controle, em .csv ou .xlsx), preenchido no
  Excel, entra pelo mesmo botão **Importar CSV**; a plataforma reconhece sozinha. Cada linha acha o atendimento pelo
  ID Contato (ou por login + data + duração, quando não há ID) e atualiza a análise; linhas que não existem viram
  atendimentos novos, com liderança e gerência do capacity. Só as colunas preenchidas mudam a análise, e importar o
  mesmo arquivo de novo não duplica nada. Sem a coluna "Resultado da Análise", o resultado é deduzido pela Status
  Classificação (Correto = cliente desligou, Incorreto = atendimento seguiu) e pela coluna "Desvio de Conduta".
  Linhas de outra carteira, ou análises de outra pessoa sem permissão, são ignoradas e contadas no aviso.
- **Aviso de atendimento já analisado**: ao colar o link do áudio, digitar o nome do áudio ou anexar o arquivo, a
  plataforma confere em todas as carteiras e de todos os usuários se aquele áudio já pertence a um atendimento
  analisado (ou em análise agora por outra pessoa) e mostra quem analisou, quando e o resultado. Compara o link
  (sem a parte ?e=… que muda a cada compartilhamento), o nome do arquivo e o IdContato contido no nome. Dá para
  abrir a análise existente ou continuar mesmo assim.

**Formulário de análise**
- Campos obrigatórios (marcados com *): carteira, telefone, contrato/CPF, data e hora, tabulação do operador, tipo de
  desconexão, login ou nome completo, segmento, gerência, resultado da análise, "A tabulação de queda procede?",
  "Segurou a ligação?" e "Houve desvio de conduta?". O que falta fica destacado em vermelho.
- **Desvio de conduta**: Sim/Não. Com Sim, escolha o motivo (desligou na cara do cliente, omissão de atendimento,
  tabulação incorreta, interromper ou faltar com respeito com o cliente, outro tipo de desvio) e descreva o desvio
  na observação, que passa a ser obrigatória. "Operador desligou" já marca Sim. A pergunta só aparece para
  cliente desligou, operador desligou e atendimento seguiu; queda técnica, ligação muda e inconclusivo nunca
  contam desvio.
- **Cards de desvio de conduta** ficam recolhidos e mostram só quantos atendimentos tiveram desvio;
  "Ver operadores" abre os cards.
- **Trocar analista** (admin): na lista, registra quem realmente fez as análises selecionadas ou todas as analisadas
  da lista filtrada (ex.: planilha importada por outra pessoa), sem mudar a data nem o resultado.
- **Tempos**: os ":" entram sozinhos ao digitar (hh:mm:ss) em Duração e Momento da queda, e a data e hora vira
  dd/mm/aaaa hh:mm:ss. Colar do Mosaic funciona: "00:05:17.520" vira 00:05:17, "2026-10-27 16:06:56" vira
  27/10/2026 16:06:56, e colar data e hora seguidas da duração preenche os dois campos.
- **Liderança, gerência, segmento e carteira puxam um ao outro**: o operador preenche liderança, gerência, campanha
  e segmento; a liderança puxa gerência e segmento; a gerência (ou o segmento) puxa a carteira mais usada; e a
  carteira limita as sugestões de gerência, liderança e segmento.
- **Enter salva**: Enter (ou "Salvar análise") confere os obrigatórios e abre um card de confirmação com o resumo.
  "Confirmar e salvar" (ou Enter de novo) grava; o X ou "Voltar à edição" volta para a análise.
- **Sair sem salvar**: clicar fora, Esc, X ou Cancelar não fecha direto. Um aviso informa que a análise não será
  salva e pergunta se quer sair ou continuar editando.

**Filtros**
- Primeira linha: visão (Consolidada/PAN/SAFRA/PORTO), **período** e busca. O período filtra pela **data da análise**
  (dia em que o atendimento foi analisado; os pendentes ficam de fora) ou pela **data da ligação**, com atalhos Hoje,
  Ontem, 7 dias e Mês, ou De/Até à mão.
- Segunda linha: carteira, gerência, liderança, operador, resultado e analista. Campanha, segmento, tabulação e
  desconexão ficam em **Mais filtros**.
- **Exportar CSV** tem os próprios **dias do relatório** (começa igual ao período da tela): um dia, um intervalo ou
  tudo, pela data da análise ou da ligação, para a visão consolidada ou por carteira. O nome do arquivo leva os dias.

Migrações: `supabase/migrations/20261101120000_px_quedas.sql`, `20261102120000_px_quedas_carteiras.sql` e
`20261103120000_px_quedas_export.sql`
(rode no SQL Editor se o deploy não aplicar migrações).

## Versão nova da plataforma

Cada publicação gera `version.json`. Com a plataforma aberta, ela confere a cada 5 minutos e quando a aba volta a ficar ativa. Se houver versão nova, aparece **Atualizar agora**.

## Filtros de seleção múltipla

Todos os filtros de lista aceitam várias escolhas, por caixa de seleção, com busca, "Marcar todos", "Limpar" e "Aplicar":
- **Painel e Atendimentos:** quinzena, produto, segmento, equipe, operador, status, campanha e alerta.
- **Análises AGV:** análise, carteira, campanha e equipe.
- **Esforço negocial:** gerência, análise (ou um dia dela), liderança e motivo.

A API recebe as listas separadas por `|`.

## Esforço negocial AGV

Menu **Esforço negocial**. É o mesmo painel dos dashboards "Esforço negocial AGV", agora alimentado pelos dados da plataforma.

**Telas**:
- Capa.
- Visão geral.
- Lideranças.
- Operadores.
- Ligações, com o modal de cada ligação.
- Evolução.

**Filtros**: gerência, análise (quinzena), liderança e motivo.

**O que é medido**:
- Esforço negocial = itens cumpridos ÷ itens que cabiam, nos 6 itens da negociação: motivo, capacidade de pagamento, proposta com valor, alternativa após o não, benefício e consequências.
- Entram só as ligações AGV com negociação: acordo, promessa, retorno ou sem acordo.
- Ficam de fora as ligações com trecho cortado em algum dos 6 itens.
- Vale o resultado final, já com as correções. Não há comparação com a leitura bruta do speech.

**A mais que o modelo**:
- Dispersão dos operadores: esforço × ligações sem acordo.
- Dispersão das ligações: duração × esforço.
- Evolução entre as análises importadas, por item, liderança e operador.

## Dashboards "Esforço negocial AGV" por carteira (leitura da transcrição)

Os arquivos `Esforco_Negocial_AGV_PAN_<carteira>_<período>.html` entram pelo botão "Importar ligações e speech" da tela Análises AGV ou em "Importar monitorias". Rode antes `supabase/migrations/20261030120000_px_agv_esforco.sql`.

**Roteiro novo** (criado pela migração):
- 5 critérios de esforço negocial: sondagem, valor da dívida, escada de ofertas, após o primeiro não e consequências.
- 6 itens do roteiro AGV dos primeiros segundos: nome do cliente, cita a Paschoalotto, aviso de gravação, sem revalidar dados, ouviu antes de ofertar e saldo com saída.
- Cada item recebe 0, ½ ou 1 e traz a evidência da ligação.

**Como as ligações entram**:
- A ligação é encontrada pelo IdContato. Se já existe (discador, speech ou outro dashboard), é completada com esta leitura, que passa a valer; senão, é criada.
- Ligações de datas anteriores do mesmo arquivo (ex.: 19/10 e 21/10) entram só com as notas, para a evolução.
- O que a Qualidade ajustou à mão nunca é sobrescrito.

**Material para o feedback** no card do atendimento e na janela da ligação:
- O que fez bem e as oportunidades.
- O que poderia ter tentado, com frases prontas.
- O que o cliente disse e a postura.
- O texto pronto para o e-mail.

"Preencher com sugestão" e o botão "Aplicar feedback" do painel levam esse material para o formulário de feedback.

**Painel de esforço negocial**:
- Usa este roteiro quando há ligações nele (dá para trocar para o roteiro antigo).
- O esforço é a média das ligações. A gerência é a registrada no dashboard para cada ligação.
- "Para tratativa": esforço abaixo de 60%, sem tentativa após o não ou postura.
- Mostra o roteiro dos primeiros segundos.
- A evolução compara as análises do arquivo.

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
