// Browser geometry and observer APIs used by anchored Radix popovers.
import { vi } from "vitest";
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLElement.prototype.scrollIntoView = vi.fn();
