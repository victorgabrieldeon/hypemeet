// Excerpts of port/web/net.js, Tenkaichi3Decomp @ 81507cde58685a6f5aab917c298d9a9f82fe09b0 (MIT), for patch.test.ts.
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search);
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // (no I and O: not mistaken for 1 and 0)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  let cid = store.get('bt3.cid', '');
  if (!cid) { cid = Math.random().toString(36).slice(2, 12); store.set('bt3.cid', cid); }
  const myName = () => store.get('bt3.name', 'Player').slice(0, 16) || 'Player';
  const named = () => !!(store.get('bt3.name', '') || '').trim(); // (a name was chosen: asked for before the first match)
  const wsUrl = (room, role, phase) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/net/ws?room=${room}` +
    `&role=${role}&phase=${phase}&name=${encodeURIComponent(myName())}&cid=${cid}`;
    const post = (e) => { try { fetch('/net/stat', { method: 'POST', body: JSON.stringify(e), keepalive: true }).catch(() => {}); } catch (x) {} };
      const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/net/queue?name=${encodeURIComponent(myName())}&cid=${cid}`);
})();
