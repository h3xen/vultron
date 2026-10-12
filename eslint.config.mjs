import js from "@eslint/js";
import security from "eslint-plugin-security";

const browser = Object.fromEntries(
  ["window", "document", "customElements", "HTMLElement", "setTimeout", "clearTimeout",
   "setInterval", "clearInterval", "console", "localStorage", "requestAnimationFrame",
   "CustomEvent", "Event", "ResizeObserver", "Intl", "fetch", "DOMParser", "Node", "URL"].map((n) => [n, "readonly"]),
);
const node = Object.fromEntries(
  ["require", "module", "process", "console", "__dirname", "Buffer", "URL"].map((n) => [n, "readonly"]),
);

export default [
  { ignores: ["node_modules/**", "vultron/**/*.py"] },
  js.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      // Same fałszywe alarmy przy indeksowaniu tablic/słowników po kluczu z danych sensora.
      "security/detect-object-injection": "off",
      "no-unused-vars": "warn",
    },
  },
  { files: ["vultron/*.js"], languageOptions: { sourceType: "script", globals: browser } },
  { files: ["tests/*.cjs"], languageOptions: { sourceType: "commonjs", globals: node } },
];
