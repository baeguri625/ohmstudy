/* 저장소: 문제·풀이 기록은 IndexedDB, 설정은 localStorage. 모두 이 브라우저 안에만 저장됩니다. */
window.DB = (() => {
  "use strict";
  const NAME = "ohmstudy", VER = 1;
  let db = null, memory = false;
  const mem = { questions: new Map(), attempts: new Map() };

  function open() {
    return new Promise((resolve) => {
      if (!window.indexedDB) { memory = true; return resolve(false); }
      let req;
      try { req = indexedDB.open(NAME, VER); } catch (e) { memory = true; return resolve(false); }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("questions")) d.createObjectStore("questions", { keyPath: "id" });
        if (!d.objectStoreNames.contains("attempts")) d.createObjectStore("attempts", { keyPath: "id" });
      };
      req.onsuccess = () => { db = req.result; resolve(true); };
      req.onerror = () => { memory = true; resolve(false); };
    });
  }
  function tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode); const s = t.objectStore(store);
      let out; const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
  }
  async function all(store) { if (memory) return [...mem[store].values()]; return (await tx(store, "readonly", (s) => s.getAll())) || []; }
  async function putMany(store, items) {
    if (memory) { items.forEach((i) => mem[store].set(i.id, i)); return; }
    await tx(store, "readwrite", (s) => { items.forEach((i) => s.put(i)); });
  }
  const put = (store, item) => putMany(store, [item]);
  async function delMany(store, ids) {
    if (memory) { ids.forEach((id) => mem[store].delete(id)); return; }
    await tx(store, "readwrite", (s) => { ids.forEach((id) => s.delete(id)); });
  }
  async function clear(store) { if (memory) { mem[store].clear(); return; } await tx(store, "readwrite", (s) => s.clear()); }

  /* 설정 */
  const SKEY = "ohmstudy:settings";
  function getSettings() {
    try { return Object.assign({ apiKey: "", model: "gemini-2.5-flash", plan: null, seeded: false }, JSON.parse(localStorage.getItem(SKEY) || "{}")); }
    catch (e) { return { apiKey: "", model: "gemini-2.5-flash", plan: null, seeded: false }; }
  }
  function saveSettings(s) { try { localStorage.setItem(SKEY, JSON.stringify(s)); return true; } catch (e) { return false; } }

  return { open, all, put, putMany, delMany, clear, getSettings, saveSettings, isMemory: () => memory };
})();
