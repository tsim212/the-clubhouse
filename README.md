# The Clubhouse v2
Zero-dependency Node 18+ app. `ADMIN_PASSWORD=pick-one node server.js` → http://localhost:3000 , commissioner page at /admin.
Live data: ESPN public fantasy API, league 1963911 (current season is public). Past seasons (2018–2025) are seeded from data/history-seed.json
(ESPN requires login cookies for old seasons; set ESPN_S2 + ESPN_SWID if the league ever goes private).
PINs: scrypt-hashed, 5 wrong tries → 15 min lockout. Admin reset revokes existing sessions.
Storage: data/store.json locally; on Render free tier the disk is wiped on redeploy/sleep, so set UPSTASH_REDIS_REST_URL/TOKEN (free Upstash Redis).
Deploy free on Vercel Hobby (no card): import this GitHub repo at vercel.com/new (Framework preset: Other; leave build settings empty — vercel.json sets them).
Static files come from public/; /api/* and /admin go to the serverless function api/index.js (wraps server.js).
Env vars (Project → Settings → Environment Variables): ADMIN_PASSWORD, SESSION_SECRET (any long random string),
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (free Upstash Redis; Vercel Marketplace's Upstash integration sets KV_REST_API_URL/TOKEN, also accepted).
Optional: LEAGUE_ID (default 1963911), SEASON, ESPN_S2 + ESPN_SWID.
In production (VERCEL or NODE_ENV=production) nothing is written to disk; without Upstash, PIN/notes calls return a clear error. ESPN data is fetched on request and cached in memory + Upstash (league 60s, free agents 10min, news 15min).
Local Vercel-style test: `node vercel-harness.js` (port 4100).
Test: `python3 test_e2e.py` with server on :4100.
