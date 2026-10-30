# PX Monitorias — instalação no servidor da Paschoalotto (sem Supabase)

A PX Monitorias roda inteira num servidor da empresa com só dois componentes: um **PostgreSQL** e o **programa da
plataforma** (Deno). Nenhum serviço externo é necessário. O Nginx fica na frente, cuidando do HTTPS.

- **Telas:** HTML, CSS e JavaScript (pasta `public/`), entregues pelo próprio programa.
- **Programa (`servidor/main.ts`):** TypeScript executado pelo Deno. Faz a API, o login (senhas em bcrypt, sessão por
  token assinado), o tempo real (Server-Sent Events) e guarda os áudios em disco.
- **Banco:** PostgreSQL 14 ou mais novo, com a extensão `pgcrypto` (vem com o PostgreSQL).

```
Navegador ──HTTPS 443──> Nginx ──> 127.0.0.1:8080  Programa PX (Deno)
                                                     ├─ telas (public/)
                                                     ├─ API /px-api · login /auth · tempo real /realtime
                                                     ├─ áudios em disco (PX_FILES_DIR)
                                                     └──> PostgreSQL (banco px_monitorias)
                                                     └──> Microsoft Graph, Azure Speech, Anthropic, SMTP (opcionais)
```

## O que vem neste pacote

| Caminho | O que é |
| --- | --- |
| `public/` | Telas |
| `servidor/main.ts`, `servidor/deno.json` | Programa da plataforma |
| `supabase/functions/px-api/` | Regras da API (usadas pelo programa; o nome da pasta é histórico) |
| `implantacao-vm/sql/px_monitorias_postgres.sql` | SQL completo do banco (estrutura + dados padrão) |
| `implantacao-vm/sql/LEIA-ME_SQL.md` | Banco e migração dos dados do Supabase |
| `implantacao-vm/px.env.example` | Configuração (banco, segredo, e-mail, integrações) |
| `implantacao-vm/px-monitorias.service` | Serviço do systemd |
| `implantacao-vm/nginx/px-monitorias.conf` | Nginx (HTTPS e tempo real) |
| `implantacao-vm/scripts/` | Migração dos dados, atualização, backup |
| `desktop/criar-atalho-windows.ps1` | Atalho PX na área de trabalho (um usuário ou todos) |

Código também no GitHub: `https://github.com/gasalomao12-cyber/Painel-de-monitorias-e-an-lises-Pan` (branch `main`).

## Requisitos

| Item | Recomendado |
| --- | --- |
| Sistema | Ubuntu Server 24.04 LTS (22.04 serve; Windows Server também roda Deno e PostgreSQL) |
| vCPU / memória / disco | 2 vCPU, 4 GB, 60 GB SSD (cerca de 10 usuários; o disco cresce com os áudios) |
| Software | PostgreSQL 14+, Deno 2.x (um executável), Nginx, Git |
| Domínio | `px.EMPRESA.com.br`, com certificado TLS |
| Saída HTTPS | `registry.npmjs.org` e `jsr.io` na 1ª execução (bibliotecas do programa); opcionais: `graph.microsoft.com` e `login.microsoftonline.com` (planilha de ações), Azure Speech, `api.anthropic.com`, SMTP |

Portas: 443 e 80 para os usuários; 8080 (programa) e 5432 (PostgreSQL) só em localhost; 22 na rede de administração.

## Passo a passo

### 1. Preparar o servidor
```bash
apt install -y postgresql nginx git unzip
curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh    # ou baixe o executável do GitHub do Deno
useradd --system --home /opt/px-app px
mkdir -p /var/lib/px-monitorias/arquivos /etc/px-monitorias && chown -R px:px /var/lib/px-monitorias
```

### 2. Banco
```bash
sudo -u postgres createuser px --pwprompt
sudo -u postgres createdb px_monitorias -O px
sudo -u postgres psql -d px_monitorias -c "create extension if not exists pgcrypto"
psql "postgres://px:SENHA@127.0.0.1:5432/px_monitorias" -v ON_ERROR_STOP=1 -f implantacao-vm/sql/px_monitorias_postgres.sql
```

### 3. Programa
```bash
git clone https://github.com/gasalomao12-cyber/Painel-de-monitorias-e-an-lises-Pan /opt/px-app
cp /opt/px-app/implantacao-vm/px.env.example /etc/px-monitorias/px.env   # preencher; chmod 600; chown px
cp /opt/px-app/implantacao-vm/px-monitorias.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now px-monitorias
curl http://127.0.0.1:8080/px-api/healthz     # {"ok":true}
```
`PX_JWT_SECRET`: 64 caracteres aleatórios (`openssl rand -hex 32`). Na primeira vez o Deno baixa as bibliotecas
(postgres, bcryptjs, nodemailer e as das integrações) e guarda em cache.

### 4. Nginx
Copie `implantacao-vm/nginx/px-monitorias.conf` para `/etc/nginx/sites-available/`, troque o domínio e os certificados,
ative e recarregue (`nginx -t && systemctl reload nginx`).

### 5. Primeiro administrador (instalação nova, sem migrar dados)
```sql
select public.px_bootstrap_admin('e-mail do administrador', 'Nome', 'senha provisória');
```
Ele troca a senha no primeiro acesso e, a partir daí, **cria, altera, reseta senha e desativa os acessos pela tela
Usuários & acessos**, sem depender do T.I.

### 6. Migração dos dados do Supabase (virada)
Passo a passo em `implantacao-vm/sql/LEIA-ME_SQL.md`. Em resumo, com a plataforma atual pausada:
1. `exportar-do-supabase.sh` gera os usuários (com as senhas em bcrypt) e todas as tabelas.
2. `importar-no-postgres.sh` carrega no banco novo. Todos continuam entrando com a mesma senha.
3. `baixar-audios.ts` traz os áudios da força-tarefa para `PX_FILES_DIR`.
4. Teste: login, uma análise de queda com áudio, exportação CSV e o tempo real com duas abas abertas.

### 7. Depois da virada
- Divulgue o endereço novo. O atalho na área de trabalho de cada pessoa precisa ser recriado com o endereço novo.
- No GitHub, desative os workflows `.github/workflows/pages.yml` e `supabase.yml`, que publicam na nuvem.
- Backup diário: `30 2 * * * /opt/px-app/implantacao-vm/scripts/backup.sh /backup/px` (cópias fora do servidor e criptografadas).
- Atualizações: `implantacao-vm/scripts/atualizar.sh` (baixa do GitHub, aplica as migrações novas e reinicia o serviço).

## Atalho na área de trabalho

Cada usuário cria o atalho **PX Monitorias** (ícone PX, janela própria no Edge/Chrome) pelo botão da tela de login, pelo
ícone da barra superior ou pelo convite no primeiro acesso. O atalho usa o endereço de onde a plataforma foi aberta.

Para todos os computadores de uma vez (GPO de inicialização ou Intune), como administrador:
```powershell
powershell -ExecutionPolicy Bypass -File desktop\criar-atalho-windows.ps1 -Url https://px.EMPRESA.com.br -TodosUsuarios
```

## Segurança

- O navegador só fala com o próprio servidor (mesmo endereço). Não existe chave de banco nem segredo nas telas.
- Senhas em bcrypt; sessão de 1 hora renovada por token guardado só como hash; 10 senhas erradas por e-mail bloqueiam
  novas tentativas por 15 minutos; acessos desativados e senhas trocadas derrubam as sessões abertas.
- Áudios em disco, entregues só por link assinado de 10 minutos.
- O banco guarda telefone e contrato/CPF de clientes da força-tarefa de queda: dado pessoal (LGPD). Acesso restrito ao
  servidor e backup criptografado.
- Monitoramento sugerido: `https://px.EMPRESA.com.br/px-api/healthz` a cada 5 minutos e alerta de disco acima de 80%.
