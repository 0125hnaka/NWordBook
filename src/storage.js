import { initialState, parseState, STORAGE_KEY } from './domain.js';

/** A failed/corrupt store is preserved. The session then uses memory only. */
export function createStateStore(catalog, getStorage = () => globalThis.localStorage) {
  let writable = true;
  let notice = '';
  let storage;
  let state = initialState(catalog);
  try {
    storage = getStorage();
    const raw = storage.getItem(STORAGE_KEY);
    if (raw !== null) state = parseState(raw);
    state = { ...state, datasetVersion: catalog.manifest.datasetVersion };
  } catch {
    writable = false;
    notice = '保存データを読み込めません。この画面では一時保存で学習できます。元の保存データは上書きしません。必要な状態はエクスポートしてください。';
  }
  return {
    get state() { return state; },
    get notice() { return notice; },
    get persistent() { return writable; },
    save(next) {
      state = next;
      if (writable) {
        try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
        catch {
          writable = false;
          notice = 'ブラウザーに保存できません。一時状態で学習を続けます。画面を閉じる前に設定からエクスポートしてください。';
        }
      }
      return state;
    },
  };
}
