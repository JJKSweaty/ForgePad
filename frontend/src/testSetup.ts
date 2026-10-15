// Browser geometry and observer APIs used by anchored Radix popovers.
import { vi } from "vitest";
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLElement.prototype.scrollIntoView = vi.fn();
window.scrollTo = vi.fn();
// Node's experimental storage globals must not shadow jsdom's browser storage.
function browserStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => [...values.keys()][index] ?? null,
  };
}
vi.stubGlobal("localStorage", browserStorage());
vi.stubGlobal("sessionStorage", browserStorage());
window.matchMedia = vi.fn().mockImplementation((media: string) => ({
  matches: false,
  media,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));
