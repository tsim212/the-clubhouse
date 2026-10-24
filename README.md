# The Clubhouse v2
Zero-dependency Node 18+ app. `ADMIN_PASSWORD=pick-one node server.js` → http://localhost:3000 , commissioner page at /admin.
Live data: ESPN public fantasy API, league 1963911 (current season is public). Past seasons (2018–2025) are seeded from data/history-seed.json
(ESPN requires login cookies for old seasons; set ESPN_S2 + ESPN_SWID if the league ever goes private).
PINs: scrypt-hashed, 5 wrong tries → 15 min lockout. Admin reset revokes existing sessions.
Storage: data/store.json locally; on Render free tier the disk is wiped on redeploy/sleep, so set UPSTASH_REDIS_REST_URL/TOKEN (free Upstash Redis).
Deploy (free): push this folder to a GitHub repo → Render "New Blueprint" → pick repo (uses render.yaml) → fill ADMIN_PASSWORD + Upstash values.
Test: `python3 test_e2e.py` with server on :4100.
