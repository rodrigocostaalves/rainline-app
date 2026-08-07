/* RainLine — API no Cloudflare Worker
   Rotas sob /api/. Tudo que não for /api/ é servido como arquivo estático
   pelo binding ASSETS (a pasta public/).

   Bindings esperados no wrangler.jsonc:
     DB     -> banco D1
     PHOTOS -> bucket R2
*/

const SESSION_DAYS = 30;
const ITER = 100000;

/* ---------- utilidades ---------- */

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });

const hex = (buf) =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

const unhex = (s) =>
  new Uint8Array((s.match(/.{1,2}/g) || []).map(b => parseInt(b, 16)));

const id = (p) => p + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);

async function hashPassword(password, saltHex) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256
  );
  return { salt: saltHex || hex(salt), hash: hex(bits) };
}

// comparação de tempo constante, para não vazar a senha pelo relógio
function sameSecret(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  const hit = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : null;
}

async function currentUser(req, env) {
  const token = readCookie(req, 'rl_session');
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?1 AND u.active = 1`
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
    return null;
  }
  return row;
}

/* ---------- rotas ---------- */

async function login(req, env) {
  const { username, password } = await req.json();
  if (!username || !password) return json({ error: 'missing' }, 400);

  const u = await env.DB.prepare(
    'SELECT * FROM users WHERE username = ?1 AND active = 1'
  ).bind(String(username).trim().toLowerCase()).first();

  // mesmo sem usuário, gastamos o mesmo tempo — não entrega quais nomes existem
  const salt = u ? u.salt : '00000000000000000000000000000000';
  const { hash } = await hashPassword(password, salt);
  if (!u || !sameSecret(hash, u.hash)) return json({ error: 'invalid' }, 401);

  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = Date.now();
  const exp = now + SESSION_DAYS * 86400000;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?1,?2,?3,?4)'
  ).bind(token, u.id, now, exp).run();

  return json(
    { user: { id: u.id, username: u.username, name: u.name, role: u.role } },
    200,
    { 'set-cookie': cookie('rl_session', token, SESSION_DAYS * 86400) }
  );
}

async function logout(req, env) {
  const token = readCookie(req, 'rl_session');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
  return json({ ok: true }, 200, { 'set-cookie': cookie('rl_session', '', 0) });
}

async function changePassword(req, env, me) {
  const { current, next } = await req.json();
  if (!next || String(next).length < 4) return json({ error: 'short' }, 400);
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(me.id).first();
  const { hash } = await hashPassword(current || '', u.salt);
  if (!sameSecret(hash, u.hash)) return json({ error: 'invalid' }, 401);
  const fresh = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET salt = ?1, hash = ?2 WHERE id = ?3')
    .bind(fresh.salt, fresh.hash, me.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1 AND token != ?2')
    .bind(me.id, readCookie(req, 'rl_session')).run();
  return json({ ok: true });
}

async function listUsers(env) {
  const r = await env.DB.prepare(
    'SELECT id, username, name, role, active FROM users ORDER BY created_at'
  ).all();
  return json({ users: r.results || [] });
}

async function createUser(req, env) {
  const { username, name, password, role } = await req.json();
  if (!username || !password) return json({ error: 'missing' }, 400);
  const { salt, hash } = await hashPassword(password);
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, username, name, role, salt, hash, active, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,1,?7)`
    ).bind(
      id('u'), String(username).trim().toLowerCase(), name || username,
      role === 'admin' ? 'admin' : 'seller', salt, hash, Date.now()
    ).run();
  } catch (e) {
    return json({ error: 'exists' }, 409);
  }
  return json({ ok: true });
}

async function listJobs(req, env, me) {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get('since') || 0);
  const mine = me.role === 'admin' ? null : me.id;
  const q = mine
    ? env.DB.prepare(
        'SELECT * FROM jobs WHERE updated_at > ?1 AND user_id = ?2 ORDER BY updated_at DESC LIMIT 400'
      ).bind(since, mine)
    : env.DB.prepare(
        'SELECT * FROM jobs WHERE updated_at > ?1 ORDER BY updated_at DESC LIMIT 400'
      ).bind(since);
  const r = await q.all();
  const jobs = (r.results || []).map(row => ({
    id: row.id, updated_at: row.updated_at, deleted: row.deleted,
    status: row.status, user_id: row.user_id,
    data: row.deleted ? null : JSON.parse(row.data)
  }));
  return json({ jobs, now: Date.now() });
}

async function putJob(req, env, me, jobId) {
  const body = await req.json();
  const d = body.data || {};
  const c = d.client || {};
  const now = Date.now();

  const existing = await env.DB.prepare('SELECT user_id, updated_at FROM jobs WHERE id = ?1')
    .bind(jobId).first();
  if (existing && existing.user_id !== me.id && me.role !== 'admin') {
    return json({ error: 'forbidden' }, 403);
  }
  // quem chegou por último com dado mais novo vence
  if (existing && body.updated_at && existing.updated_at > body.updated_at) {
    return json({ conflict: true, updated_at: existing.updated_at }, 409);
  }

  await env.DB.prepare(
    `INSERT INTO jobs (id, user_id, client_name, address, city, state, zip, phone, email,
                       feet, total, status, data, updated_at, deleted)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,0)
     ON CONFLICT(id) DO UPDATE SET
       client_name=excluded.client_name, address=excluded.address, city=excluded.city,
       state=excluded.state, zip=excluded.zip, phone=excluded.phone, email=excluded.email,
       feet=excluded.feet, total=excluded.total, status=excluded.status,
       data=excluded.data, updated_at=excluded.updated_at, deleted=0`
  ).bind(
    jobId, existing ? existing.user_id : me.id,
    c.name || '', c.address || '', c.city || '', c.state || '', c.zip || '',
    c.phone || '', c.email || '',
    Number(d.feet) || 0, Number(d.total) || 0, d.status || 'draft',
    JSON.stringify(d), now
  ).run();

  return json({ ok: true, updated_at: now });
}

async function deleteJob(env, me, jobId) {
  const row = await env.DB.prepare('SELECT user_id FROM jobs WHERE id = ?1').bind(jobId).first();
  if (!row) return json({ ok: true });
  if (row.user_id !== me.id && me.role !== 'admin') return json({ error: 'forbidden' }, 403);
  await env.DB.prepare(
    "UPDATE jobs SET deleted = 1, data = '{}', updated_at = ?2 WHERE id = ?1"
  ).bind(jobId, Date.now()).run();
  return json({ ok: true });
}

async function uploadPhoto(req, env, me) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job');
  if (!jobId) return json({ error: 'missing job' }, 400);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 8 * 1024 * 1024) return json({ error: 'size' }, 413);

  const key = `jobs/${jobId}/${id('p')}.jpg`;
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: 'image/jpeg' } });
  await env.DB.prepare(
    'INSERT INTO photos (id, job_id, key, level, feet, created_at) VALUES (?1,?2,?3,?4,?5,?6)'
  ).bind(
    id('ph'), jobId, key,
    Number(url.searchParams.get('level')) || 1,
    Number(url.searchParams.get('feet')) || 0,
    Date.now()
  ).run();
  return json({ key });
}

async function getPhoto(env, key) {
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
      'cache-control': 'private, max-age=86400'
    }
  });
}

/* ---------- roteador ---------- */

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(req) : new Response('not found', { status: 404 });
    }
    if (!env.DB) return json({ error: 'DB binding ausente' }, 500);

    try {
      if (path === '/api/health') return json({ ok: true, time: Date.now() });
      if (path === '/api/login' && req.method === 'POST') return await login(req, env);
      if (path === '/api/logout' && req.method === 'POST') return await logout(req, env);

      const me = await currentUser(req, env);
      if (!me) return json({ error: 'auth' }, 401);

      if (path === '/api/me') return json({ user: me });
      if (path === '/api/password' && req.method === 'POST') return await changePassword(req, env, me);

      if (path === '/api/users') {
        if (me.role !== 'admin') return json({ error: 'forbidden' }, 403);
        if (req.method === 'GET') return await listUsers(env);
        if (req.method === 'POST') return await createUser(req, env);
      }

      if (path === '/api/jobs' && req.method === 'GET') return await listJobs(req, env, me);

      const jm = path.match(/^\/api\/jobs\/([\w-]+)$/);
      if (jm) {
        if (req.method === 'PUT') return await putJob(req, env, me, jm[1]);
        if (req.method === 'DELETE') return await deleteJob(env, me, jm[1]);
      }

      if (path === '/api/photos' && req.method === 'POST') {
        if (!env.PHOTOS) return json({ error: 'R2 binding ausente' }, 500);
        return await uploadPhoto(req, env, me);
      }
      if (path.startsWith('/api/photos/') && req.method === 'GET') {
        if (!env.PHOTOS) return json({ error: 'R2 binding ausente' }, 500);
        return await getPhoto(env, decodeURIComponent(path.slice('/api/photos/'.length)));
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: 'server', detail: String(err && err.message || err) }, 500);
    }
  }
};
