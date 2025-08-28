/**
 * Cloudflare Worker that stores tournaments JSON in a GitHub repo.
 *
 * ENV (set in Workers Dashboard):
 * - APP_KEY    : shared secret; must match X-App-Key header from the app
 * - GH_TOKEN   : a GitHub PAT with repo scope (use a fine-scoped classic PAT or a fine-grained token)
 * - GH_OWNER   : your GitHub username/org (e.g., "pradeepmurthy1992")
 * - GH_REPO    : repo name that will store the data (e.g., "tourney-store")
 * - GH_PATH    : file path within the repo (e.g., "data/tournaments.json")
 *
 * ROUTES:
 * GET  /load  -> returns {ok:true, data:{tournaments,deleted}} (creates empty if missing)
 * POST /save  -> body {tournaments, deleted}, requires header X-App-Key
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/load" && request.method === "GET") {
      return load(env);
    }
    if (url.pathname === "/save" && request.method === "POST") {
      const appKey = request.headers.get("X-App-Key") || "";
      if (!env.APP_KEY || appKey !== env.APP_KEY) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const body = await safeJson(request);
      if (!body || typeof body !== "object") return json({ ok: false, error: "bad_body" }, 400);
      const payload = {
        tournaments: Array.isArray(body.tournaments) ? body.tournaments : [],
        deleted: Array.isArray(body.deleted) ? body.deleted : []
      };
      return save(env, payload);
    }
    return json({ ok: false, error: "not_found" }, 404);
  }
};

async function load(env) {
  const res = await gh(env, "GET");
  if (res.status === 404) {
    // initialize empty file in repo
    const init = { tournaments: [], deleted: [] };
    await putGh(env, init, null, "init tournaments.json");
    return json({ ok: true, data: init });
  }
  if (!res.ok) return json({ ok: false, error: `github_load_${res.status}` }, 502);
  const obj = await res.json();
  if (!obj || !obj.content) return json({ ok: false, error: "no_content" }, 502);
  const decoded = JSON.parse(atob(obj.content));
  return json({ ok: true, data: decoded });
}

async function save(env, payload) {
  // get current sha (if exists)
  const res = await gh(env, "GET");
  let sha = null;
  if (res.ok) {
    const obj = await res.json();
    sha = obj.sha || null;
  }
  const put = await putGh(env, payload, sha, "update tournaments.json");
  if (!put.ok) return json({ ok: false, error: `github_save_${put.status}` }, 502);
  return json({ ok: true });
}

async function gh(env, method) {
  const { GH_OWNER, GH_REPO, GH_PATH, GH_TOKEN } = env;
  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;
  return fetch(api, {
    method,
    headers: {
      "Authorization": `Bearer ${GH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "gameport-tournaments/1.0"
    }
  });
}

async function putGh(env, data, sha, message) {
  const { GH_OWNER, GH_REPO, GH_PATH, GH_TOKEN } = env;
  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;
  const body = {
    message,
    content: btoa(JSON.stringify(data, null, 2)),
    ...(sha ? { sha } : {})
  };
  return fetch(api, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${GH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "gameport-tournaments/1.0",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function safeJson(request) {
  try { return await request.json(); } catch { return null; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
