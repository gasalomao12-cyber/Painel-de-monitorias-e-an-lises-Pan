// @ts-nocheck — modo servidor próprio: PostgreSQL puro, sem Supabase.
// Implementa o pedaço da interface do supabase-js que a API usa (from/storage/auth.admin), para que
// as rotas funcionem iguais nos dois modos. Ligado quando PX_DATABASE_URL está definido.
import postgres from 'npm:postgres@3.4.5';
import bcrypt from 'npm:bcryptjs@2.4.3';

const env = (k, d = '') => Deno.env.get(k) || d;
export const LOCAL = !!env('PX_DATABASE_URL');

// ---------------------------------------------------------------- Conexão
// Números (bigint/numeric) como Number e datas como texto ISO, igual ao que o PostgREST devolvia
const iso = (s) => (s == null ? s : String(s).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
let sqlConn = null;
export function sql() {
  if (!sqlConn) {
    sqlConn = postgres(env('PX_DATABASE_URL'), {
      max: Number(env('PX_DB_POOL', '10')),
      onnotice: () => {},
      connection: { TimeZone: 'UTC', application_name: 'px-monitorias' },
      types: {
        int8: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) },
        numeric: { to: 1700, from: [1700], serialize: (x) => String(x), parse: (x) => Number(x) },
        tstz: { to: 1184, from: [1184], serialize: (x) => (x instanceof Date ? x.toISOString() : String(x)), parse: iso },
        ts: { to: 1114, from: [1114], serialize: (x) => String(x), parse: iso },
        date: { to: 1082, from: [1082], serialize: (x) => String(x), parse: (x) => x },
      },
    });
  }
  return sqlConn;
}

// Tipos das colunas (tabelas e views), para converter cada valor com o tipo certo
let colTypes = null;
async function types(table) {
  if (!colTypes) {
    const rows = await sql().unsafe(`select c.relname t, a.attname c, format_type(a.atttypid, a.atttypmod) ty,
        (select array_agg(att.attname) from pg_index i join pg_attribute att on att.attrelid = i.indrelid and att.attnum = any(i.indkey)
          where i.indrelid = c.oid and i.indisprimary) pk
      from pg_class c join pg_attribute a on a.attrelid = c.oid
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m') and a.attnum > 0 and not a.attisdropped`);
    colTypes = new Map();
    for (const r of rows) {
      const t = colTypes.get(r.t) || colTypes.set(r.t, { cols: new Map(), pk: r.pk || [] }).get(r.t);
      t.cols.set(r.c, r.ty);
    }
  }
  const t = colTypes.get(table);
  if (!t) throw Object.assign(new Error(`Tabela desconhecida: ${table}`), { code: '42P01' });
  return t;
}
export function resetTypes() { colTypes = null; }

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

// ---------------------------------------------------------------- Consultas (estilo supabase-js)
class Query {
  constructor(table) {
    this.table = table; this.kind = 'select'; this.cols = '*'; this.where = []; this.params = [];
    this.orders = []; this.lim = null; this.off = null; this.mode = null; this.returning = false; this.countHead = false;
  }
  // parâmetro tipado pela coluna
  p(col, v, meta) {
    const ty = meta.cols.get(col) || 'text';
    if (v === null || v === undefined) { this.params.push(null); return `$${this.params.length}::text::${ty}`; }
    if (ty.endsWith('[]')) {
      this.params.push(JSON.stringify(Array.isArray(v) ? v : [v]));
      return `array(select jsonb_array_elements_text($${this.params.length}::text::jsonb))::${ty}`;
    }
    if (ty === 'jsonb' || ty === 'json') { this.params.push(typeof v === 'string' ? v : JSON.stringify(v)); return `$${this.params.length}::text::${ty}`; }
    this.params.push(v instanceof Date ? v.toISOString() : String(v));
    return `$${this.params.length}::text::${ty}`;
  }
  pArr(col, list, meta) {
    const ty = (meta.cols.get(col) || 'text').replace(/\[\]$/, '');
    this.params.push(JSON.stringify(list.map((x) => (x == null ? null : String(x)))));
    return `array(select jsonb_array_elements_text($${this.params.length}::text::jsonb))::${ty}[]`;
  }
  f(fn) { this.where.push(fn); return this; }

  select(cols = '*', opts = {}) {
    if (this.kind === 'select') { this.cols = cols || '*'; if (opts.count && opts.head) this.countHead = true; }
    else this.returning = true;
    return this;
  }
  insert(values, opts = {}) { this.kind = 'insert'; this.values = values; this.opts = opts; return this; }
  upsert(values, opts = {}) { this.kind = 'upsert'; this.values = values; this.opts = opts; return this; }
  update(values) { this.kind = 'update'; this.values = values; return this; }
  delete() { this.kind = 'delete'; return this; }

  eq(c, v) { return this.f((m) => `${q(c)} = ${this.p(c, v, m)}`); }
  neq(c, v) { return this.f((m) => `${q(c)} <> ${this.p(c, v, m)}`); }
  gt(c, v) { return this.f((m) => `${q(c)} > ${this.p(c, v, m)}`); }
  gte(c, v) { return this.f((m) => `${q(c)} >= ${this.p(c, v, m)}`); }
  lt(c, v) { return this.f((m) => `${q(c)} < ${this.p(c, v, m)}`); }
  lte(c, v) { return this.f((m) => `${q(c)} <= ${this.p(c, v, m)}`); }
  like(c, v) { return this.f(() => { this.params.push(String(v)); return `${q(c)}::text like $${this.params.length}`; }); }
  ilike(c, v) { return this.f(() => { this.params.push(String(v)); return `${q(c)}::text ilike $${this.params.length}`; }); }
  is(c, v) { return this.f(() => `${q(c)} is ${v === null ? 'null' : v ? 'true' : 'false'}`); }
  in(c, list) { return this.f((m) => (list.length ? `${q(c)} = any(${this.pArr(c, list, m)})` : 'false')); }
  contains(c, v) { return this.f((m) => `${q(c)} @> ${this.p(c, v, m)}`); }
  overlaps(c, v) { return this.f((m) => `${q(c)} && ${this.p(c, v, m)}`); }
  not(c, op, v) { return this.f((m) => (op === 'is' ? `${q(c)} is not ${v === null ? 'null' : v ? 'true' : 'false'}` : `not (${this.cond(c, op, v, m)})`)); }
  or(expr) { return this.f((m) => `(${this.orExpr(expr, m, ' or ')})`); }

  // Filtro no formato do PostgREST: "col.op.valor", com "in.(a,b)", "and(...)", valores entre aspas e * como curinga
  cond(c, op, v, m) {
    switch (op) {
      case 'eq': return `${q(c)} = ${this.p(c, v, m)}`;
      case 'neq': return `${q(c)} <> ${this.p(c, v, m)}`;
      case 'gt': return `${q(c)} > ${this.p(c, v, m)}`;
      case 'gte': return `${q(c)} >= ${this.p(c, v, m)}`;
      case 'lt': return `${q(c)} < ${this.p(c, v, m)}`;
      case 'lte': return `${q(c)} <= ${this.p(c, v, m)}`;
      case 'like': case 'ilike': this.params.push(String(v).replace(/\*/g, '%')); return `${q(c)}::text ${op} $${this.params.length}`;
      case 'is': return `${q(c)} is ${v === null || v === 'null' ? 'null' : v === true || v === 'true' ? 'true' : 'false'}`;
      case 'in': return v.length ? `${q(c)} = any(${this.pArr(c, v, m)})` : 'false';
      default: throw new Error(`Operador não suportado: ${op}`);
    }
  }
  orExpr(expr, m, joiner) {
    const parts = splitTop(expr);
    return parts.map((part) => {
      const g = part.match(/^(and|or)\((.*)\)$/s);
      if (g) return `(${this.orExpr(g[2], m, g[1] === 'and' ? ' and ' : ' or ')})`;
      const i1 = part.indexOf('.'); const i2 = part.indexOf('.', i1 + 1);
      const col = part.slice(0, i1); let op = part.slice(i1 + 1, i2); let raw = part.slice(i2 + 1);
      let neg = false;
      if (op === 'not') { neg = true; const i3 = raw.indexOf('.'); op = raw.slice(0, i3); raw = raw.slice(i3 + 1); }
      let val;
      if (op === 'in') val = splitTop(raw.replace(/^\(|\)$/g, '')).map(unq);
      else if (op === 'is') val = raw === 'null' ? null : raw;
      else val = unq(raw);
      const c = this.cond(col, op, val, m);
      return neg ? `not (${c})` : c;
    }).join(joiner);
  }

  order(c, { ascending = true, nullsFirst } = {}) {
    this.orders.push(`${q(c)} ${ascending ? 'asc' : 'desc'}${nullsFirst === undefined ? '' : nullsFirst ? ' nulls first' : ' nulls last'}`);
    return this;
  }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.off = a; this.lim = b - a + 1; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  async build() {
    const m = await types(this.table);
    const T = `public.${q(this.table)}`;
    this.params = [];
    const whereSql = () => { const w = this.where.map((fn) => fn(m)); return w.length ? ` where ${w.join(' and ')}` : ''; };
    if (this.kind === 'select') {
      const W = whereSql();
      if (this.countHead) return `select count(*)::int as n from ${T}${W}`;
      const cols = this.cols.trim() === '*' ? '*' : this.cols.split(',').map((s) => s.trim()).filter(Boolean).map(colExpr).join(', ');
      return `select ${cols} from ${T}${W}${this.orders.length ? ` order by ${this.orders.join(', ')}` : ''}${this.lim != null ? ` limit ${Number(this.lim)}` : ''}${this.off ? ` offset ${Number(this.off)}` : ''}`;
    }
    if (this.kind === 'delete') return `delete from ${T}${whereSql()}${this.returning ? ' returning *' : ''}`;
    if (this.kind === 'update') {
      const keys = Object.keys(this.values).filter((k) => this.values[k] !== undefined);
      if (!keys.length) return null;
      const setSql = keys.map((k) => `${q(k)} = ${this.p(k, this.values[k], m)}`).join(', ');
      return `update ${T} set ${setSql}${whereSql()}${this.returning ? ' returning *' : ''}`;
    }
    // insert / upsert
    const rows = Array.isArray(this.values) ? this.values : [this.values];
    if (!rows.length) return null;
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))];
    const vals = rows.map((r) => `(${keys.map((k) => (r[k] === undefined ? 'default' : this.p(k, r[k], m))).join(', ')})`);
    let s = `insert into ${T} (${keys.map(q).join(', ')}) values ${vals.join(', ')}`;
    if (this.kind === 'upsert') {
      const conflict = this.opts.onConflict ? this.opts.onConflict.split(',').map((c) => c.trim()) : m.pk;
      const upd = keys.filter((k) => !conflict.includes(k));
      s += ` on conflict (${conflict.map(q).join(', ')}) ${this.opts.ignoreDuplicates || !upd.length ? 'do nothing' : `do update set ${upd.map((k) => `${q(k)} = excluded.${q(k)}`).join(', ')}`}`;
    }
    return s + (this.returning ? ' returning *' : '');
  }

  async run() {
    try {
      const text = await this.build(); this._text = text;
      if (text === null) return { data: this.returning || this.kind === 'select' ? [] : null, error: null };
      const rows = await sql().unsafe(text, this.params);
      if (this.countHead) return { data: null, count: rows[0]?.n || 0, error: null };
      const data = [...rows];
      if (this.kind !== 'select' && !this.returning) return { data: null, error: null };
      if (this.mode === 'single') return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: 'Esperava uma linha.', code: 'PGRST116' } };
      if (this.mode === 'maybe') return data.length > 1 ? { data: null, error: { message: 'Mais de uma linha.', code: 'PGRST116' } } : { data: data[0] || null, error: null };
      return { data, error: null };
    } catch (e) {
      if (env('PX_DEBUG_SQL')) console.error('SQL:', this.table, e.message, this._text, JSON.stringify(this.params).slice(0, 300));
      return { data: null, error: { message: e.message, code: e.code, details: e.detail, hint: e.hint } };
    }
  }
  then(ok, fail) { return this.run().then(ok, fail); }
}

// Coluna do select no formato do PostgREST: "col", "apelido:col", "apelido:json->chave->>chave"
function colExpr(c) {
  if (c === '*') return '*';
  const m = c.match(/^([\w]+):(.+)$/);
  const alias = m ? m[1] : null;
  const path = (m ? m[2] : c).split(/(->>|->)/);
  let sqlx = q(path[0].trim());
  for (let i = 1; i < path.length; i += 2) sqlx += `${path[i]}'${path[i + 1].trim().replace(/'/g, "''")}'`;
  const name = alias || (path.length > 1 ? path[path.length - 1].trim() : null);
  return name && name !== path[0].trim() ? `${sqlx} as ${q(name)}` : sqlx;
}

// divide "a,b,(c,d),\"e,f\"" no nível de cima
function splitTop(s) {
  const out = []; let depth = 0, quote = false, cur = '';
  for (const ch of String(s)) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === '(') depth++;
    if (!quote && ch === ')') depth--;
    if (!quote && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}
const unq = (v) => (v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

// ---------------------------------------------------------------- Arquivos (áudios) em disco
const FILES_DIR = () => env('PX_FILES_DIR', './arquivos');
const enc = new TextEncoder();
async function hmac(msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))));
}
const safePath = (bucket, path) => {
  const rel = `${bucket}/${path}`.replace(/\\/g, '/');
  if (rel.split('/').some((p) => p === '..' || p === '')) throw new Error('Caminho inválido.');
  return rel;
};
export async function signedFileUrl(bucket, path, seconds) {
  const rel = safePath(bucket, path);
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return `${env('PX_PUBLIC_URL', '').replace(/\/$/, '')}/files/${rel.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${await hmac(`${rel}|${exp}`)}`;
}
export async function checkFileUrl(rel, exp, sig) {
  if (!exp || Number(exp) < Date.now() / 1000) return null;
  if ((await hmac(`${rel}|${exp}`)) !== sig) return null;
  return `${FILES_DIR()}/${safePath(...splitBucket(rel))}`;
}
const splitBucket = (rel) => { const i = rel.indexOf('/'); return [rel.slice(0, i), rel.slice(i + 1)]; };

const storage = {
  from(bucket) {
    return {
      async upload(path, body) {
        try {
          const full = `${FILES_DIR()}/${safePath(bucket, path)}`;
          await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
          if (body instanceof ReadableStream) { const f = await Deno.open(full, { write: true, create: true, truncate: true }); await body.pipeTo(f.writable); }
          else await Deno.writeFile(full, body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()));
          return { data: { path }, error: null };
        } catch (e) { return { data: null, error: { message: e.message } }; }
      },
      async remove(paths) {
        for (const p of paths) { try { await Deno.remove(`${FILES_DIR()}/${safePath(bucket, p)}`); } catch { /* já não existe */ } }
        return { data: paths, error: null };
      },
      async createSignedUrl(path, seconds) {
        try { return { data: { signedUrl: await signedFileUrl(bucket, path, seconds) }, error: null }; }
        catch (e) { return { data: null, error: { message: e.message } }; }
      },
    };
  },
};

// ---------------------------------------------------------------- Usuários, senhas e tokens
export function secret() {
  const s = env('PX_JWT_SECRET');
  if (s.length < 32) throw new Error('Defina PX_JWT_SECRET com pelo menos 32 caracteres.');
  return s;
}
function b64url(bytes) { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const b64urlJson = (o) => b64url(enc.encode(JSON.stringify(o)));
function unb64url(s) { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }

export const ACCESS_TTL = 3600;
export async function signJwt(payload, ttl = ACCESS_TTL) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64urlJson({ alg: 'HS256', typ: 'JWT' })}.${b64urlJson({ ...payload, iat: now, exp: now + ttl })}`;
  return `${body}.${await hmac(body)}`;
}
export async function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  if ((await hmac(`${parts[0]}.${parts[1]}`)) !== parts[2]) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64url(parts[1])));
    return p.exp && p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
const userOut = (u) => (u ? { id: u.id, email: u.email, user_metadata: u.raw_user_meta_data || {}, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, banned_until: u.banned_until } : null);

export async function checkPassword(email, password) {
  const [u] = await sql().unsafe('select * from public.px_auth_users where lower(email) = lower($1)', [String(email || '').trim()]);
  if (!u || !u.encrypted_password) return null;
  if (u.banned_until && new Date(u.banned_until) > new Date()) return null;
  return (await bcrypt.compare(String(password || ''), u.encrypted_password)) ? u : null;
}
const hash = (pw) => bcrypt.hash(String(pw), 10);

const authAdmin = {
  async createUser({ email, password, user_metadata }) {
    try {
      const [u] = await sql().unsafe(`insert into public.px_auth_users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
        values (lower($1), $2, $3::text::jsonb, now()) returning *`, [String(email).trim(), await hash(password), JSON.stringify(user_metadata || {})]);
      return { data: { user: userOut(u) }, error: null };
    } catch (e) { return { data: null, error: { message: e.code === '23505' ? 'Este e-mail já está cadastrado.' : e.message } }; }
  },
  async updateUserById(id, attrs) {
    try {
      const sets = []; const params = [id];
      if (attrs.password) { params.push(await hash(attrs.password)); sets.push(`encrypted_password = $${params.length}`); }
      if (attrs.email) { params.push(String(attrs.email).trim().toLowerCase()); sets.push(`email = $${params.length}`); }
      if (attrs.ban_duration !== undefined) sets.push(attrs.ban_duration === 'none' ? 'banned_until = null' : "banned_until = now() + interval '100 years'");
      if (attrs.user_metadata) { params.push(JSON.stringify(attrs.user_metadata)); sets.push(`raw_user_meta_data = $${params.length}::text::jsonb`); }
      if (!sets.length) return { data: { user: null }, error: null };
      const [u] = await sql().unsafe(`update public.px_auth_users set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`, params);
      // trocou a senha ou bloqueou: as sessões antigas caem
      if (attrs.password || (attrs.ban_duration && attrs.ban_duration !== 'none')) await sql().unsafe('delete from public.px_auth_refresh where user_id = $1', [id]);
      return { data: { user: userOut(u) }, error: u ? null : { message: 'Usuário não encontrado.' } };
    } catch (e) { return { data: null, error: { message: e.message } }; }
  },
  async listUsers({ page = 1, perPage = 50 } = {}) {
    const rows = await sql().unsafe('select * from public.px_auth_users order by created_at limit $1 offset $2', [perPage, (page - 1) * perPage]);
    return { data: { users: rows.map(userOut) }, error: null };
  },
  async deleteUser(id) {
    await sql().unsafe('delete from public.px_auth_users where id = $1', [id]);
    return { data: null, error: null };
  },
  async getUserById(id) {
    const [u] = await sql().unsafe('select * from public.px_auth_users where id = $1', [id]);
    return { data: { user: userOut(u) }, error: u ? null : { message: 'Usuário não encontrado.' } };
  },
};

export function localClient() {
  return {
    from: (table) => new Query(table),
    storage,
    auth: {
      admin: authAdmin,
      async getUser(token) { const p = await verifyJwt(token); return p ? authAdmin.getUserById(p.sub) : { data: { user: null }, error: { message: 'Token inválido.' } }; },
      async signInWithPassword({ email, password }) { const u = await checkPassword(email, password); return u ? { data: { user: userOut(u) }, error: null } : { data: null, error: { message: 'E-mail ou senha incorretos.' } }; },
    },
  };
}
