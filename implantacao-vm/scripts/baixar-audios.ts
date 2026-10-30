// @ts-nocheck — Baixa os áudios da força-tarefa de queda do Supabase (plataforma atual) para a pasta do servidor novo.
// Usa a própria plataforma: entra com um administrador e baixa cada áudio pelo link assinado. Não precisa de chave do Supabase.
//
//   deno run -A baixar-audios.ts --destino /var/lib/px-monitorias/arquivos --email admin@EMPRESA.com.br
//   (a senha é pedida na tela, ou vem de PX_SENHA; o endereço e a chave pública vêm do config.js publicado da plataforma)
//
// Rode depois de importar os dados no banco novo: os caminhos são os mesmos registrados nos atendimentos.
import { parseArgs } from 'jsr:@std/cli@1.0.6/parse-args';

const a = parseArgs(Deno.args, { string: ['destino', 'email', 'site', 'supabase', 'chave', 'api'], default: { site: 'https://gasalomao12-cyber.github.io/Painel-de-monitorias-e-an-lises-Pan/' } });
if (!a.destino || !a.email) { console.error('Uso: deno run -A baixar-audios.ts --destino <pasta> --email <admin>'); Deno.exit(1); }
const cfgJs = a.supabase ? '' : await (await fetch(new URL('config.js', a.site))).text();
const supabaseUrl = a.supabase || cfgJs.match(/supabaseUrl:\s*'([^']+)'/)[1];
const key = a.chave || cfgJs.match(/publishableKey:\s*'([^']+)'/)[1];
const apiBase = a.api || `${supabaseUrl}/functions/v1/px-api`;
const password = Deno.env.get('PX_SENHA') || prompt(`Senha de ${a.email}:`);

const login = await (await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: a.email, password }) })).json();
if (!login.access_token) { console.error('Não foi possível entrar:', login.error_description || login.msg || login.error); Deno.exit(1); }
const api = (p) => fetch(`${apiBase}${p}`, { headers: { apikey: key, authorization: `Bearer ${login.access_token}` } });

const { rows } = await (await api('/quedas')).json();
const comAudio = rows.filter((r) => r.audio_path);
console.log(`${comAudio.length} áudio(s) para baixar`);
let ok = 0, falhas = 0;
for (const r of comAudio) {
  const dest = `${a.destino.replace(/\/$/, '')}/px-quedas/${r.audio_path}`;
  try {
    await Deno.stat(dest); ok++; continue; // já baixado
  } catch { /* baixa */ }
  try {
    const { url } = await (await api(`/quedas/${r.id}/audio`)).json();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await Deno.mkdir(dest.slice(0, dest.lastIndexOf('/')), { recursive: true });
    await Deno.writeFile(dest, new Uint8Array(await res.arrayBuffer()));
    ok++;
  } catch (e) { falhas++; console.error(`  falhou: atendimento ${r.contact_id || r.id} (${e.message})`); }
}
console.log(`Pronto: ${ok} áudio(s) na pasta, ${falhas} falha(s).`);
