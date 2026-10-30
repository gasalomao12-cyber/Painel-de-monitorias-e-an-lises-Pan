# SQL da PX Monitorias — migração do Supabase para o servidor da Paschoalotto

Dois tipos de SQL: a **estrutura** (tabelas, views, funções, gatilhos, dados padrão) e os **dados** (usuários,
monitorias, feedbacks, análises de queda).

| Arquivo | O que faz |
| --- | --- |
| `px_monitorias_completo.sql` | Estrutura completa: as 11 migrações em ordem, num arquivo só. Pode ser rodado mais de uma vez. |
| `../scripts/aplicar-migracoes.sh` | Mesmo resultado, migração por migração; nas atualizações, roda só as novas. |
| `../scripts/exportar-dados-supabase.sh` | Gera os `.sql` com os dados do Supabase nuvem. |
| `../scripts/importar-dados.sh` | Carrega esses dados no banco da VM. |
| `gerar-sql-completo.sh` | Refaz o `px_monitorias_completo.sql` quando entrar uma migração nova. |

## Onde roda

No PostgreSQL do **Supabase self-hosted** instalado no servidor (container `supabase-db`). O SQL usa o que o Supabase
cria no mesmo banco: `auth.users` (login), `storage.buckets` (áudios), `realtime.send` (telas ao vivo) e os papéis
`anon`, `authenticated` e `service_role`. Num PostgreSQL sem o Supabase ele não roda, porque o login, os arquivos e o
tempo real da plataforma dependem desses serviços.

## Ordem da migração

1. **Estrutura** (servidor novo, depois de subir o Supabase):
   ```bash
   docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1 < px_monitorias_completo.sql
   ```
2. **Exportar os dados da nuvem** (com a plataforma atual pausada). A connection string fica em
   *Supabase › Project Settings › Database › Connection string (URI)*, com a senha do banco:
   ```bash
   ./exportar-dados-supabase.sh "postgresql://postgres.REF:SENHA@HOST:5432/postgres" ./dados-px
   ```
   Gera `01_usuarios.sql` (logins, com as senhas criptografadas), `02_dados_px.sql` (todas as tabelas `px_*`) e
   `03_arquivos.sql` (registro dos áudios do bucket `px-quedas`).
3. **Importar no servidor**:
   ```bash
   ./importar-dados.sh ./dados-px supabase-db
   ```
   Substitui os dados padrão da instalação pelos da nuvem, acerta as sequências de ID e mostra a contagem de usuários,
   monitorias e quedas. Não roda sobre um banco que já tem usuários (use `FORCAR=1` só para refazer um ensaio).
4. **Áudios**: copie os arquivos do bucket `px-quedas` (Supabase › Storage, ou `supabase storage cp`) para o Storage
   da VM, nos mesmos caminhos registrados em `03_arquivos.sql`.
5. **Conferir**: login com um usuário existente (a senha continua a mesma), uma monitoria, uma análise de queda com
   áudio e a exportação CSV.

Como todos os usuários vêm junto, não é preciso criar o primeiro administrador nessa migração: o administrador da
plataforma continua o mesmo e segue criando os acessos pela tela Usuários & acessos.

## Teste feito

No ambiente de teste (Supabase local em Docker):
- **Estrutura:** o `px_monitorias_completo.sql` rodou 3 vezes seguidas num banco limpo, e o schema final ficou igual ao
  do banco em uso.
- **Dados:** exportar, recriar o banco e importar devolveu as mesmas contagens: 8 usuários, 1.018 monitorias,
  12.251 itens avaliados, 165 feedbacks, 94 quedas e 444 operadores do capacity. A sequência de IDs continuou do maior ID.

## Segurança

Os arquivos de dados têm informações pessoais de clientes (telefone, CPF/contrato) e de colaboradores. Transfira por
canal seguro, guarde com acesso restrito e apague as cópias depois da importação.
