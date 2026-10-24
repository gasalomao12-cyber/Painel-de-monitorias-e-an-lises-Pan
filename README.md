# PX Monitorias & Feedbacks · Paschoalotto

Plataforma web (servidor na nuvem) para publicar os reports quinzenais de qualidade de **Refinanciamento** e **Entrega Amigável**: monitorias auditadas, ajuste da análise do speech, análise de transcrições com IA, registro de feedbacks e geração de dashboards com capa.

## O que a plataforma faz

| Área | Recursos |
|---|---|
| **Login e boas-vindas** | Login seguro, troca de senha obrigatória no 1º acesso, tela de boas-vindas onde a pessoa diz **como gostaria de ser chamada** e escolhe o tema (escuro/claro). |
| **Painel** | KPIs (nota média, conformidade, monitorias, % de feedback, falhas críticas, análises corrigidas), insights automáticos, **evolução por quinzena**, **dispersão speech × nota final**, **mapa de desempenho** (média × consistência), distribuição de notas, critérios ofensores, ranking com tendência. |
| **Atendimentos** | Um card por monitoria com nota, speech × final, status, falha crítica, ajustes e link do áudio. **Card verde = feedback aplicado.** Filtros, busca, lista/grade, exportação Excel. |
| **Card detalhado** | **Ajuste de análise** por critério (Conforme / Parcial / Não conforme / N/A) com motivo obrigatório e recálculo da nota ao vivo; parecer da IA com evidências; transcrição com busca; **aplicação de feedback** (o que foi passado, pontos fortes, melhorias, plano de ação, ciência do operador, reavaliação); histórico completo. |
| **Análise com IA** | Anexe transcrições (.txt, .docx, .vtt, .srt, .json), em lote. A IA (Claude) avalia cada critério com o trecho da fala, **corrige sozinha o que o speech interpretou errado** (confiança alta) e sugere o feedback. Ajustes manuais nunca são sobrescritos. Sem chave, roda uma heurística local apenas como sugestão. |
| **Feedbacks** | Abas de **pendentes** (por operador ou prioridade) e **aplicados** (histórico com filtros e exportação). |
| **Dashboards & reports** | Visão geral, comparativo entre quinzenas, Refin × Entrega e individual do operador — **com capa**, páginas A4 paisagem, impressão em PDF e download em HTML. |
| **Admin** | Quinzenas e **links das pastas de áudio do OneDrive** (por quinzena, por atendimento ou em lote, editáveis a qualquer momento), critérios e pesos, usuários e perfis, bugs reportados, auditoria, configurações da IA, backup. |
| **Reportar bug** | Botão flutuante em todas as telas (com print opcional). O admin trata e o usuário é notificado. |
| **Atalho PX** | Em *Meu perfil › Atalho na área de trabalho*: gera o instalador do atalho **PX Monitorias** com o ícone PX (Windows) ou instala como aplicativo (PWA). |

### Perfis de acesso
- **Administrador** — tudo, inclusive links de áudio, quinzenas, critérios, usuários e configurações.
- **Qualidade** — importa monitorias, ajusta análises, usa a IA, aplica feedbacks, gera reports.
- **Supervisão** — consulta atendimentos e gráficos, aplica e registra feedbacks (pode ser restrita à própria equipe).

### Regra de nota
Conforme = 100% do peso · Parcial = 50% · Não conforme = 0 · N/A sai da base. Critério **crítico** em “Não conforme” zera a nota.

## Como rodar

Requisitos: **Node.js 22.13 ou superior** (usa o SQLite nativo do Node; não precisa de banco externo).

```bash
npm install
npm start          # http://localhost:3000
```

No primeiro start são criados o usuário `admin` / `Px@2026admin` (troca obrigatória no 1º acesso) e dados de demonstração. Usuários demo: `qualidade`, `supervisor.alfa`, `supervisor.beta` — senha `Px@2026demo`. Remova a demonstração em *Configurações › Dados*.

Variáveis de ambiente: veja `.env.example` (`PORT`, `DATA_DIR`, `ADMIN_USER`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `SEED_DEMO`, `SESSION_DAYS`).

### Publicar na nuvem
- **Render**: suba o repositório e use o `render.yaml` (já inclui disco persistente em `/var/data`).
- **Docker** (Railway, Fly.io, Azure, VM): `docker build -t px-monitorias . && docker run -p 3000:3000 -v px-data:/data px-monitorias`.
- Use HTTPS (necessário para instalar como app e recomendado para o login).
- **Importante:** o banco fica em `DATA_DIR`; aponte para um disco persistente e baixe backups em *Configurações*.

### Ativar a IA
Crie uma chave em console.anthropic.com e defina `ANTHROPIC_API_KEY` no servidor (ou cadastre em *Configurações › Inteligência artificial*). Modelo padrão: Claude Opus 5.5, com fallback automático do servidor em caso de recusa.

### Atalho na área de trabalho
- Pela plataforma: *Meu perfil › Atalho para Windows* baixa um `.bat` que já sabe o endereço do servidor.
- Pela pasta `desktop/`: `Criar atalho PX Monitorias.bat` pede o endereço e cria o atalho com `px.ico`.
- `desktop/Iniciar servidor local.bat` sobe a plataforma numa máquina Windows local.

## Importação da planilha do speech
*Importar monitorias › Modelo .xlsx*: uma linha por atendimento (operador, matrícula, equipe, supervisor, produto, data, protocolo, contrato, cliente, duração, nota speech, link áudio, resumo) e uma coluna por critério pelo **código** (ex.: `IDT`, `RCE`, `ESD`) com C/P/NC/NA — também aceita Sim/Não/Parcial. Colunas `OBS <código>` viram a observação do speech. Operadores novos são cadastrados automaticamente.

## Estrutura
```
server/   index.js (HTTP), routes.js (API), db.js (SQLite), auth.js, ai.js (Claude + heurística), io.js (planilhas/transcrições), scoring.js, seed.js
public/   index.html (SPA), report.html (dashboards), css/, js/ (app, views, charts), icons/ (PX)
desktop/  atalho do Windows e ícone PX
```
