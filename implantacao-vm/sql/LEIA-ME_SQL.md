# SQL da PX Monitorias — PostgreSQL da Paschoalotto (sem Supabase)

| Arquivo | O que faz |
| --- | --- |
| `px_monitorias_postgres.sql` | Banco completo: 19 tabelas, 8 views, funções, gatilhos, login próprio (`px_auth_users`) e os dados padrão (63 critérios dos roteiros e configurações). |
| `../scripts/exportar-do-supabase.sh` | Tira do Supabase os usuários (com as senhas em bcrypt) e todas as tabelas `px_*`. |
| `../scripts/importar-no-postgres.sh` | Carrega esses dados no PostgreSQL da empresa e acerta as sequências de ID. |
| `../scripts/baixar-audios.ts` | Baixa os áudios da força-tarefa de queda para a pasta do servidor novo. |
| `../scripts/aplicar-migracoes.sh` | Nas atualizações, roda só as migrações novas. |

## Requisitos

PostgreSQL 14 ou mais novo, com a extensão `pgcrypto` (faz parte do PostgreSQL; serve para as senhas em bcrypt).
Nenhum recurso do Supabase é usado: o login, o tempo real e os arquivos são do próprio programa da plataforma.

## Banco novo

```bash
sudo -u postgres createuser px --pwprompt
sudo -u postgres createdb px_monitorias -O px
sudo -u postgres psql -d px_monitorias -c "create extension if not exists pgcrypto"
psql "postgres://px:SENHA@127.0.0.1:5432/px_monitorias" -v ON_ERROR_STOP=1 -f px_monitorias_postgres.sql
```
Sem migrar dados, crie o primeiro administrador (troca a senha no primeiro acesso):
```sql
select public.px_bootstrap_admin('e-mail do administrador', 'Nome', 'senha provisória');
```

## Migração dos dados do Supabase

Com a plataforma atual pausada:

1. **Exportar** (precisa da connection string do banco: *Supabase › Project Settings › Database › Connection string*,
   com a senha do banco):
   ```bash
   ./exportar-do-supabase.sh "postgresql://postgres.REF:SENHA@HOST:5432/postgres" ./dados-px
   ```
   Gera `01_usuarios.csv` (só quem tem acesso à plataforma) e `02_dados_px.sql`.
2. **Importar** no banco novo, com o superusuário `postgres`, porque a carga desliga os gatilhos das tabelas:
   ```bash
   ./importar-no-postgres.sh "postgres://postgres:SENHA@127.0.0.1:5432/px_monitorias" ./dados-px
   ```
   Substitui os dados padrão da instalação pelos do Supabase e mostra quantos usuários, monitorias e quedas entraram.
   Não roda sobre um banco que já tem usuários (só com `FORCAR=1`, para refazer um ensaio).
3. **Áudios** (pela própria plataforma atual, com um usuário administrador; não precisa de chave do Supabase):
   ```bash
   deno run -A baixar-audios.ts --destino /var/lib/px-monitorias/arquivos --email admin@EMPRESA.com.br
   ```
4. **Conferir:** entrar com um usuário existente (a senha continua a mesma), abrir uma monitoria e uma análise de queda
   com áudio, exportar o CSV.

## Teste feito

No ambiente de teste, com PostgreSQL 17 sem nenhum componente do Supabase:
- **Banco:** o `px_monitorias_postgres.sql` criou o banco com o usuário `px` (dono do banco, sem superusuário), e o
  `px_bootstrap_admin` criou um administrador que entrou na plataforma.
- **Migração:** exportar do Supabase e importar trouxe 8 usuários, 1.018 monitorias, 12.251 itens, 165 feedbacks, 94 quedas
  e 444 operadores. Os usuários entraram com as senhas que já tinham.
- **Áudios:** o `baixar-audios.ts` trouxe o arquivo idêntico, byte a byte.
- **Plataforma no servidor novo:** formulário de análise, filtros e exportação CSV, cards de desvio, troca de analista,
  atalho, importação do discador e da planilha de análises, áudio (envio, link assinado, remoção), criação de acesso,
  troca de senha, bloqueio, tempo real e backup.

## Segurança

Os arquivos exportados têm dados pessoais de clientes (telefone, CPF/contrato) e de colaboradores. Transfira por canal
seguro, guarde com acesso restrito e apague as cópias depois da importação.
