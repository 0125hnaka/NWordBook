// Each answer/mark/timer has its own atomic localStorage entry. A stale tab can
// overwrite the entry it edits, but cannot replace another question's data.
// The old v1 document remains a read-only baseline for existing installations.
export function createExamEntries({ key, valid, decodeLegacy, validate, getStorage }) {
  const prefix = `${key}:entry:`;
  let storage, entries = {}, persistent = true, notice = '';
  const fail = () => {
    persistent = false;
    notice = '回答・採点・時間を端末に保存できないため一時保存中です。元の保存内容は上書きしません。閉じる前に回答バックアップを保存してください。';
  };
  function read() {
    const raw = storage.getItem(key);
    const next = raw === null ? {} : decodeLegacy(raw);
    // Browser storage is enumerable. The fallback also supports minimal storage
    // adapters without key()/length (including quota-failure adapters).
    const names = typeof storage.key === 'function' && Number.isInteger(storage.length)
      ? Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(k => k?.startsWith(prefix))
      : [...valid].map(id => prefix + encodeURIComponent(id));
    for (const name of names) {
      const id = decodeURIComponent(name.slice(prefix.length));
      if (!valid.has(id)) throw new Error('Unknown saved entry');
      const item = storage.getItem(name);
      if (item !== null) {
        const record = JSON.parse(item);
        if (record?.schemaVersion !== 1 || !Object.hasOwn(record, 'value')) throw new Error('Invalid saved entry');
        if (record.value === null) delete next[id]; else next[id] = record.value;
      }
    }
    validate(next);
    return next;
  }
  function refresh() {
    if (persistent) try { entries = read(); } catch { fail(); }
    return entries;
  }
  try { storage = getStorage(); entries = read(); } catch { fail(); }
  return {
    get entries() { return entries; }, get persistent() { return persistent; }, get notice() { return notice; },
    refresh,
    write(patch) {
      if (Object.keys(patch).some(id => !valid.has(id))) throw new Error('Unknown saved entry');
      refresh();
      const next = { ...entries };
      for (const [id, value] of Object.entries(patch)) {
        if (value === null) delete next[id]; else next[id] = value;
      }
      entries = next;
      try { validate(next); } catch { fail(); return; }
      if (persistent) try {
        for (const [id, value] of Object.entries(patch)) storage.setItem(prefix + encodeURIComponent(id), JSON.stringify({ schemaVersion: 1, value }));
      } catch { fail(); }
    },
  };
}

export function isExamStorageChange(key) {
  return key === null || ['nwordbook:exam-answers:v1', 'nwordbook:exam-practice:v1'].some(base => key === base || key.startsWith(`${base}:entry:`));
}
