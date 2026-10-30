# PX Monitorias — implantação em VM (guia do T.I.)

Este guia leva a PX Monitorias inteira para uma VM da empresa: telas, banco, login, áudios e API.
A plataforma continua igual para os usuários; só muda o endereço.

- **Telas:** HTML, CSS e JavaScript estáticos (pasta `public/`, sem build).
- **API:** TypeScript executado pelo Deno (`supabase/functions/px-api`).
- **Banco:** PostgreSQL, dentro do Supabase self-hosted (Docker), que também traz login, arquivos e tempo real.

```
Navegador ──HTTPS 443──> Nginx ──> px.EMPRESA      → /opt/px-app/public (telas)
                               └─> px-api.EMPRESA  → Kong 127.0.0.1:8000 → Auth · Realtime · Storage · px-api → Postgres
                                                                                                   px-api → Microsoft Graph, Azure Speech, Anthropic (opcionais)
```

## O que vem neste pacote

| Caminho | O que é |
| --- | --- |
| `public/` | Telas (o Nginx serve esta pasta) |
| `supabase/functions/px-api/` | API |
| `supabase/migrations/` | Scripts do banco, rodados em ordem de data |
| `implantacao-vm/nginx/px-monitorias.conf` | Configuração do Nginx (telas + proxy da API com WebSocket) |
| `implantacao-vm/sql/px_monitorias_completo.sql` | SQL completo do banco (estrutura), num arquivo só |
| `implantacao-vm/sql/LEIA-ME_SQL.md` | Como migrar estrutura e dados do Supabase para o servidor |
| `implantacao-vm/scripts/aplicar-migracoes.sh` | Cria/atualiza o banco, rodando só as migrações novas |
| `implantacao-vm/scripts/exportar-dados-supabase.sh`, `importar-dados.sh` | Levam os dados da nuvem para a VM |
| `desktop/criar-atalho-windows.ps1` | Cria o atalho PX na área de trabalho (uma pessoa ou todos os usuários do computador) |
| `implantacao-vm/scripts/configurar-telas.sh` | Aponta as telas para o domínio da VM (config.js, CSP, version.json) |
| `implantacao-vm/scripts/atualizar.sh` | Atualiza tudo a partir do GitHub |
| `implantacao-vm/scripts/backup.sh` | Backup diário do banco e dos áudios |
| `implantacao-vm/functions.env.example` | Variáveis das integrações (planilha, transcrição, IA) |

O código também está no GitHub: `https://github.com/gasalomao12-cyber/Painel-de-monitorias-e-an-lises-Pan` (branch `main`).

## Requisitos

| Item | Recomendado |
| --- | --- |
| Sistema | Ubuntu Server 24.04 LTS (22.04 também serve) |
| vCPU / memória / disco | 4 vCPU, 8 GB, 100 GB SSD (mínimo: 2 vCPU, 4 GB, 40 GB) |
| Software | Docker Engine 24+, Docker Compose v2, Nginx, Git |
| Domínios | `px.EMPRESA.com.br` (telas) e `px-api.EMPRESA.com.br` (API), com certificado TLS |
| Saída HTTPS | `registry.npmjs.org` (dependências da API na 1ª execução); `graph.microsoft.com` e `login.microsoftonline.com` (planilha de ações); opcionais: Azure Speech e `api.anthropic.com` |

Portas: 443 e 80 para os usuários; 8000 (Kong) só em localhost; 5432 (Postgres), 3000 (Studio) e 22 só na rede de administração.

## Passo a passo

### 1. Preparar a VM
Instale Docker Engine, Docker Compose v2, Nginx e Git. Libere 80/443.

### 2. Supabase self-hosted
Guia oficial: https://supabase.com/docs/guides/self-hosting/docker

```bash
git clone --depth 1 https://github.com/supabase/supabase /tmp/supabase
mkdir -p /opt/px && cp -r /tmp/supabase/docker/. /opt/px/
cd /opt/px && cp .env.example .env
```

No `/opt/px/.env`, troque **todos** os segredos de exemplo e preencha:

| Variável | Valor |
| --- | --- |
| `POSTGRES_PASSWORD` | senha forte |
| `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` | gere com o gerador do guia oficial; a `SERVICE_ROLE_KEY` nunca sai do servidor |
| `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` | acesso ao Studio |
| `SITE_URL` | `https://px.EMPRESA.com.br/` |
| `ADDITIONAL_REDIRECT_URLS` | `https://px.EMPRESA.com.br/redefinir-senha.html` |
| `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL` | `https://px-api.EMPRESA.com.br` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME` | SMTP da empresa ("esqueci minha senha") |
| `ENABLE_EMAIL_SIGNUP` | `false` (só o administrador da plataforma cria acessos) |
| `FUNCTIONS_VERIFY_JWT` | `false` (a própria API confere o login de cada chamada) |

### 3. Código e API
```bash
git clone https://github.com/gasalomao12-cyber/Painel-de-monitorias-e-an-lises-Pan /opt/px-app
cp -r /opt/px-app/supabase/functions/px-api /opt/px/volumes/functions/
cp /opt/px-app/implantacao-vm/functions.env.example /opt/px/functions.env   # preencher; chmod 600
```
No `docker-compose.yml` do Supabase, no serviço `functions`, acrescente `env_file: ./functions.env`.

```bash
cd /opt/px && docker compose up -d
```

### 4. Banco
SQL completo num arquivo só (ou o script, que faz o mesmo migração por migração):
```bash
docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1 < /opt/px-app/implantacao-vm/sql/px_monitorias_completo.sql
# ou: /opt/px-app/implantacao-vm/scripts/aplicar-migracoes.sh /opt/px-app supabase-db
```

### 5. Telas
```bash
/opt/px-app/implantacao-vm/scripts/configurar-telas.sh https://px-api.EMPRESA.com.br "<ANON_KEY do .env>" /opt/px-app
```

### 6. Nginx
Copie `implantacao-vm/nginx/px-monitorias.conf` para `/etc/nginx/sites-available/`, troque os domínios e os certificados,
ative e recarregue (`nginx -t && systemctl reload nginx`).

Teste: `https://px-api.EMPRESA.com.br/functions/v1/px-api/healthz` deve responder `{"ok":true}`.

### 7. Primeiro administrador
Crie o usuário em **Studio › Authentication › Add user** (e-mail e senha, *Auto Confirm User*) e rode no banco:
```sql
select public.px_bootstrap_admin('e-mail do administrador', 'Nome do administrador');
```
A partir daí, **o administrador da plataforma (Qualidade) cria, altera, reseta senha e desativa os acessos pela tela
Usuários & acessos**, sem depender do T.I.

### 8. Migração dos dados (virada)
Detalhes em `implantacao-vm/sql/LEIA-ME_SQL.md`. Com a plataforma atual pausada:
```bash
# na VM, com a connection string do banco do Supabase (Project Settings › Database)
implantacao-vm/scripts/exportar-dados-supabase.sh "postgresql://postgres.REF:SENHA@HOST:5432/postgres" ./dados-px
implantacao-vm/scripts/importar-dados.sh ./dados-px supabase-db
```
Vêm os usuários (com as mesmas senhas), todas as tabelas `px_*` e o registro dos áudios; depois copie os arquivos do
bucket `px-quedas`. Como os usuários vêm junto, o passo 7 não é necessário numa migração.
Teste: login, "esqueci minha senha", uma análise de queda com áudio, exportação CSV e o tempo real com duas abas abertas.
Ensaie numa cópia antes da virada.

### 9. Depois da virada
- Divulgue o endereço novo.
- No GitHub, desative os workflows `.github/workflows/pages.yml` e `supabase.yml` (eles publicam na nuvem).
- Agende o backup: `30 2 * * * /opt/px-app/implantacao-vm/scripts/backup.sh /backup/px` (cópias fora da VM e criptografadas).
- Atualizações: `implantacao-vm/scripts/atualizar.sh https://px-api.EMPRESA.com.br "<ANON_KEY>"`.

## Atalho na área de trabalho

Cada usuário pode criar o atalho **PX Monitorias** (ícone PX, janela própria no Edge/Chrome) sozinho: botão na tela de
login, botão na barra superior e um convite no primeiro acesso pelo computador. O atalho usa o endereço de onde a
plataforma foi aberta, então já aponta para a VM.

Para colocar o atalho em todos os computadores de uma vez (GPO de inicialização ou Intune), como administrador:
```powershell
powershell -ExecutionPolicy Bypass -File desktop\criar-atalho-windows.ps1 -Url https://px.EMPRESA.com.br -TodosUsuarios
```
Cria o atalho na Área de Trabalho Pública e no Menu Iniciar. O ícone vem junto (`desktop/px.ico`) ou do próprio servidor.

## Segurança

- As tabelas `px_*` têm RLS ligado e nenhuma policy: o navegador não lê nada direto; tudo passa pela API, que confere o
  login e o perfil (admin, qualidade, supervisor).
- O navegador só recebe a `ANON_KEY` (pública por definição). `SERVICE_ROLE_KEY`, `JWT_SECRET` e as chaves das integrações
  ficam só no servidor.
- O banco guarda telefone e contrato/CPF de clientes da força-tarefa de queda: dado pessoal (LGPD). Acesso restrito e backup
  criptografado.
- Monitoramento sugerido: `/functions/v1/px-api/healthz` a cada 5 minutos e alerta de disco acima de 80%.
