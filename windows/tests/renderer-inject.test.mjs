import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const windowsRoot = path.resolve(here, "..");
const template = await fs.readFile(path.join(windowsRoot, "assets", "renderer-inject.js"), "utf8");
const css = await fs.readFile(path.join(windowsRoot, "assets", "dream-skin.css"), "utf8");
const buildPayload = (config = {}) => template
  .replace("__DREAM_CSS_JSON__", JSON.stringify(".fixture { color: blue; }"))
  .replace("__DREAM_ART_JSON__", JSON.stringify("data:image/png;base64,AA=="))
  .replace("__DREAM_THEME_JSON__", JSON.stringify(config));
const payload = buildPayload();

assert.doesNotMatch(
  css,
  /main\.main-surface\s*>\s*header\.app-header-tint\s*\{[^}]*\b(?:position|z-index)\s*:/,
  "The skin must preserve Codex's native fixed header so the side-panel toggle remains reachable.",
);

const normalizedCss = css.replace(/\s+/g, " ");

function cssRuleBody(selector) {
  const selectorIndex = normalizedCss.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `Missing CSS selector: ${selector}`);

  const openBrace = normalizedCss.indexOf("{", selectorIndex);
  const closeBrace = normalizedCss.indexOf("}", openBrace);
  assert.ok(
    openBrace > selectorIndex && closeBrace > openBrace,
    `Malformed CSS rule: ${selector}`,
  );
  return normalizedCss.slice(openBrace + 1, closeBrace);
}

assert.match(
  cssRuleBody(".dream-home > div:first-child > div:first-child > div:first-child"),
  /overflow:\s*visible\s*!important;/,
  "The Windows home hero must not clip the native suggestion row positioned below it.",
);
assert.match(
  cssRuleBody("html.codex-dream-skin .dream-home"),
  /--thread-content-max-width:\s*min\(1180px,\s*calc\(100cqw\s*-\s*20px\)\)\s*!important;/,
  "The Windows home width must leave room for Codex's native fourth suggestion at common display scaling.",
);
assert.match(
  cssRuleBody(".dream-home > div:first-child > div:first-child > div:first-child"),
  /width:\s*calc\(100%\s*-\s*20px\)\s*!important;/,
  "The Windows hero must expose enough container width for four native Codex cards.",
);

const settingsSurfaceSelector =
  'main.main-surface:not(.dream-home-shell) ' +
  '[class~="main-surface"][class~="h-full"][class~="min-h-0"][class~="flex-col"]';
const settingsSurfaceRule = cssRuleBody(settingsSurfaceSelector);
assert.match(
  settingsSurfaceRule,
  /color:\s*var\(--dream-text\)\s*!important;/,
  "The real Windows settings surface must use the active theme text color.",
);
assert.match(
  settingsSurfaceRule,
  /background:\s*transparent\s*!important;/,
  "The real Windows settings surface must stay transparent so the outer themed task wash remains visible.",
);

const sharedComposerBackground =
  /background:\s*var\(--dream-immersive-composer\)\s*!important;/;
assert.match(
  cssRuleBody("html.codex-dream-skin .composer-surface-chrome"),
  sharedComposerBackground,
  "The base composer must use the immersive composer color for standard and wide artwork.",
);
assert.match(
  cssRuleBody("html.codex-dream-skin .dream-home-utility"),
  sharedComposerBackground,
  "The home utility bar and composer must use the same background token.",
);
assert.match(
  cssRuleBody(
    'html.codex-dream-skin aside.app-shell-left-panel div:has(> input[type="text"])',
  ),
  sharedComposerBackground,
  "The Windows settings search field must not retain its native light surface.",
);
assert.match(
  cssRuleBody('html.codex-dream-skin [class~="group/application-menu-top-bar"]'),
  /color:\s*var\(--dream-text\)\s*!important;/,
  "The Windows application menu must follow theme text in light and dark shells.",
);

function createFixture({
  shellPresent,
  mainPresent = shellPresent,
  sidebarPresent = shellPresent,
  staleSkin = false,
  homePresent = false,
  modernHomePresent = false,
  semanticHomePresent = false,
  roleMainPresent = true,
  utilityPresent = false,
  shellAppearance = "dark",
  computedColorScheme = "",
  osAppearance = "light",
  analysisFixture = null,
}) {
  const nodes = new Map();
  const rootClasses = new Set(staleSkin ? ["codex-dream-skin"] : []);
  const rootStyles = new Map(staleSkin ? [["--dream-art", "url(\"blob:stale\")"]] : []);
  const rootPriorities = new Map();
  const revokedUrls = [];
  const observers = [];
  let objectUrlCount = 0;
  let hasMain = mainPresent;
  let hasSidebar = sidebarPresent;
  let hasModernHome = modernHomePresent;
  let hasRoleMain = roleMainPresent;
  let root;

  const queueRootClassMutation = () => {
    for (const observer of observers) {
      if (observer.target !== root || !observer.options?.attributes) continue;
      if (observer.options.attributeFilter && !observer.options.attributeFilter.includes("class")) continue;
      observer.records.push({ type: "attributes", attributeName: "class", target: root });
    }
  };
  const makeClassList = (classes = new Set(), onMutation = () => {}) => ({
    add(...values) {
      let changed = false;
      for (const value of values) {
        if (!classes.has(value)) { classes.add(value); changed = true; }
      }
      if (changed) onMutation();
    },
    remove(...values) {
      let changed = false;
      for (const value of values) changed = classes.delete(value) || changed;
      if (changed) onMutation();
    },
    toggle(value, enabled) {
      const changed = enabled ? !classes.has(value) : classes.has(value);
      if (enabled) classes.add(value);
      else classes.delete(value);
      if (changed) onMutation();
    },
    contains(value) { return classes.has(value); },
  });

  root = {
    className: shellAppearance,
    classList: makeClassList(rootClasses, queueRootClassMutation),
    getAttribute() { return null; },
    style: {
      setProperty(key, value, priority = "") {
        rootStyles.set(key, value);
        if (priority) rootPriorities.set(key, priority);
        else rootPriorities.delete(key);
      },
      removeProperty(key) {
        rootStyles.delete(key);
        rootPriorities.delete(key);
      },
    },
    appendChild(node) {
      node.parentElement = root;
      nodes.set(node.id, node);
    },
  };
  const body = {
    className: "",
    getAttribute() { return null; },
    appendChild(node) {
      node.parentElement = body;
      nodes.set(node.id, node);
    },
  };
  const shellClasses = new Set();
  const shellMain = {
    classList: makeClassList(shellClasses),
    getBoundingClientRect() {
      return { left: 290, top: 36, width: 990, height: 784 };
    },
  };
  const routeClasses = new Set();
  const utilityClasses = new Set();
  const utilityNode = { classList: makeClassList(utilityClasses) };
  const routeMain = {
    classList: makeClassList(routeClasses),
    querySelectorAll(selector) {
      if (selector === '[class*="_homeUtilityBar_"]' && utilityPresent) return [utilityNode];
      return [];
    },
  };
  const staleHome = { classList: makeClassList(new Set(["dream-home"])) };
  const staleShell = { classList: makeClassList(new Set(["dream-home-shell"])) };

  const createElement = (tagName) => {
    if (tagName === "canvas" && analysisFixture) {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() { return { data: analysisFixture.pixels }; },
          };
        },
      };
    }
    return {
      id: "",
      dataset: {},
      style: {},
      classList: makeClassList(),
      parentElement: null,
      textContent: "",
      innerHTML: "",
      setAttribute() {},
      remove() { nodes.delete(this.id); },
    };
  };
  if (staleSkin) {
    const style = createElement();
    style.id = "codex-dream-skin-style";
    nodes.set(style.id, style);
    const chrome = createElement();
    chrome.id = "codex-dream-skin-chrome";
    nodes.set(chrome.id, chrome);
  }

  const document = {
    documentElement: root,
    head: root,
    body,
    createElement,
    getElementById(id) { return nodes.get(id) ?? null; },
    querySelector(selector) {
      if (selector === "main.main-surface") return hasMain ? shellMain : null;
      if (selector === "main") return hasMain ? shellMain : null;
      if (selector === "aside.app-shell-left-panel") return hasSidebar ? {} : null;
      if (selector === '[role="main"]:has([data-testid="home-icon"])') {
        return hasMain && hasRoleMain && homePresent ? routeMain : null;
      }
      if (selector === '[class~="[container-name:home-main-content]"]') {
        return hasMain && hasModernHome ? routeMain : null;
      }
      if (selector === '[role="main"]:has([data-feature="game-source"]):has(.group\\/home-suggestions)') {
        return hasMain && hasRoleMain && semanticHomePresent ? routeMain : null;
      }
      if (selector === '[data-feature="game-source"]') {
        return semanticHomePresent ? { closest() { return routeMain; } } : null;
      }
      if (selector === '[role="main"]') return hasMain && hasRoleMain ? routeMain : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[role="main"]') return hasMain && hasRoleMain ? [routeMain] : [];
      if (selector === ".dream-home, .dream-task") {
        return [
          ...(routeClasses.has("dream-home") || routeClasses.has("dream-task") ? [routeMain] : []),
          ...(shellClasses.has("dream-home") || shellClasses.has("dream-task") ? [shellMain] : []),
        ];
      }
      if (selector === ".dream-task") {
        return [
          ...(routeClasses.has("dream-task") ? [routeMain] : []),
          ...(shellClasses.has("dream-task") ? [shellMain] : []),
        ];
      }
      if (selector === ".dream-home-utility") {
        return utilityClasses.has("dream-home-utility") ? [utilityNode] : [];
      }
      if (!staleSkin) return [];
      if (selector === ".dream-home") return [staleHome];
      if (selector === ".dream-home-shell") return [staleShell];
      return [];
    },
  };
  const context = {
    window: {
      matchMedia() { return { matches: osAppearance === "dark" }; },
    },
    document,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.records = [];
        this.target = null;
        this.options = null;
        observers.push(this);
      }
      observe(target, options = {}) {
        this.target = target;
        this.options = options;
      }
      disconnect() {
        this.target = null;
        this.records = [];
      }
      takeRecords() {
        const records = this.records;
        this.records = [];
        return records;
      }
    },
    URL: {
      createObjectURL() { objectUrlCount += 1; return `blob:fixture-${objectUrlCount}`; },
      revokeObjectURL(value) { revokedUrls.push(value); },
    },
    Blob,
    Uint8Array,
    atob,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 2,
    clearTimeout: () => {},
    getComputedStyle() { return { colorScheme: computedColorScheme }; },
  };
  if (analysisFixture) {
    context.Image = class {
      naturalWidth = analysisFixture.naturalWidth;
      naturalHeight = analysisFixture.naturalHeight;
      set src(_) { this.onload(); }
    };
  }

  return {
    context,
    nodes,
    observers,
    rootClasses,
    rootPriorities,
    rootStyles,
    revokedUrls,
    routeClasses,
    shellClasses,
    utilityClasses,
    setShellPresent(value) {
      hasMain = value;
      hasSidebar = value;
    },
    setSidebarPresent(value) { hasSidebar = value; },
    setMainPresent(value) { hasMain = value; },
    setModernHomePresent(value) { hasModernHome = value; },
    setRoleMainPresent(value) { hasRoleMain = value; },
  };
}

const main = createFixture({ shellPresent: true });
const mainResult = vm.runInNewContext(payload, main.context);
assert.equal(mainResult.installed, true);
assert.equal(main.rootClasses.has("codex-dream-skin"), true);
assert.equal(main.rootStyles.get("--dream-art"), 'url("blob:fixture-1")');
assert.equal(main.nodes.has("codex-dream-skin-style"), true);
assert.equal(main.nodes.has("codex-dream-skin-chrome"), true);
assert.equal(main.rootClasses.has("dream-theme-dark"), true);
assert.equal(main.rootClasses.has("dream-art-standard"), true);
assert.equal(main.rootClasses.has("dream-task-ambient"), true);
assert.equal(main.routeClasses.has("dream-task"), true);
assert.equal(main.context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);
assert.equal(main.rootClasses.has("codex-dream-skin"), false);
assert.equal(main.rootClasses.has("dream-theme-dark"), false);
assert.equal(main.nodes.has("codex-dream-skin-style"), false);
assert.equal(main.nodes.has("codex-dream-skin-chrome"), false);
assert.deepEqual(main.revokedUrls, ["blob:fixture-1"]);

const reinjected = createFixture({ shellPresent: true });
vm.runInNewContext(payload, reinjected.context);
const firstState = reinjected.context.window.__CODEX_DREAM_SKIN_STATE__;
vm.runInNewContext(payload, reinjected.context);
const secondState = reinjected.context.window.__CODEX_DREAM_SKIN_STATE__;
assert.notEqual(secondState.installToken, firstState.installToken);
assert.equal(secondState.artUrl, "blob:fixture-2");
assert.equal(reinjected.rootStyles.get("--dream-art"), 'url("blob:fixture-2")');
assert.deepEqual(reinjected.revokedUrls, ["blob:fixture-1"]);
assert.equal(firstState.cleanup(), false);
assert.equal(secondState.cleanup(), true);

const auxiliary = createFixture({ shellPresent: false, staleSkin: true });
const auxiliaryResult = vm.runInNewContext(payload, auxiliary.context);
assert.equal(auxiliaryResult.installed, true);
assert.equal(auxiliary.rootClasses.has("codex-dream-skin"), false);
assert.equal(auxiliary.rootStyles.has("--dream-art"), false);
assert.equal(auxiliary.nodes.has("codex-dream-skin-style"), false);
assert.equal(auxiliary.nodes.has("codex-dream-skin-chrome"), false);

auxiliary.setShellPresent(true);
auxiliary.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(auxiliary.rootClasses.has("codex-dream-skin"), true);
assert.equal(auxiliary.nodes.has("codex-dream-skin-style"), true);
assert.equal(auxiliary.nodes.has("codex-dream-skin-chrome"), true);

// Collapsing the left rail removes aside.app-shell-left-panel while the main
// surface remains. The active theme must stay applied instead of flashing the
// native Codex chrome.
const collapsedSidebar = createFixture({
  shellPresent: true,
  mainPresent: true,
  sidebarPresent: false,
  staleSkin: true,
});
const collapsedResult = vm.runInNewContext(payload, collapsedSidebar.context);
assert.equal(collapsedResult.installed, true);
assert.equal(collapsedSidebar.rootClasses.has("codex-dream-skin"), true);
assert.equal(collapsedSidebar.rootStyles.has("--dream-art"), true);
assert.equal(collapsedSidebar.nodes.has("codex-dream-skin-style"), true);
assert.equal(collapsedSidebar.nodes.has("codex-dream-skin-chrome"), true);
assert.equal(collapsedSidebar.rootClasses.has("dream-theme-dark"), true);

collapsedSidebar.setSidebarPresent(false);
collapsedSidebar.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(collapsedSidebar.rootClasses.has("codex-dream-skin"), true);
assert.equal(collapsedSidebar.nodes.has("codex-dream-skin-style"), true);

collapsedSidebar.setMainPresent(false);
collapsedSidebar.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(collapsedSidebar.rootClasses.has("codex-dream-skin"), false);
assert.equal(collapsedSidebar.nodes.has("codex-dream-skin-style"), false);

const configured = createFixture({
  shellPresent: true,
  homePresent: true,
  utilityPresent: true,
});
const configuredPayload = buildPayload({
  appearance: "light",
  palette: { accent: "#d45a70" },
  art: { focusX: .15, focusY: .8, safeArea: "right", taskMode: "off" },
});
const configuredResult = vm.runInNewContext(configuredPayload, configured.context);
assert.equal(configuredResult.adaptive, true);
assert.equal(configured.rootClasses.has("dream-theme-light"), true);
assert.equal(configured.rootClasses.has("dream-theme-dark"), false);
assert.equal(configured.rootClasses.has("dream-focus-left"), true);
assert.equal(configured.rootClasses.has("dream-safe-right"), true);
assert.equal(configured.rootClasses.has("dream-task-off"), true);
assert.equal(configured.rootStyles.get("--dream-art-position"), "15% 80%");
assert.equal(configured.rootStyles.get("--dream-accent"), "#d45a70");
assert.equal(configured.routeClasses.has("dream-home"), true);
// A normal theme has no colors{} contract. It may still set Dream Skin's own
// adaptive variables, but it must not overwrite Codex's native token palette.
for (const nativeProperty of [
  "--vscode-editor-background",
  "--vscode-foreground",
  "--vscode-input-background",
  "--color-token-bg-primary",
  "--color-token-main-surface-primary",
  "--color-token-text-primary",
  "--color-token-charts-blue",
  "--color-background-panel",
  "--color-text-foreground",
]) {
  assert.equal(
    configured.rootStyles.has(nativeProperty),
    false,
    `A theme without colors{} must not set ${nativeProperty}.`,
  );
}

// Gothic-style packs use colors{} (macOS contract). Windows must honor them so
// dark structure surfaces do not fall back to the light shell palette.
const gothic = createFixture({ shellPresent: true, shellAppearance: "light" });
const gothicPayload = buildPayload({
  appearance: "auto",
  colors: {
    background: "#0d0d0e",
    panel: "#171513",
    panelAlt: "#211d18",
    accent: "#c8a55a",
    text: "#f3ead7",
    muted: "#b5a386",
    line: "rgba(200, 165, 90, .28)",
  },
  art: { focusX: .76, focusY: .45, safeArea: "left", taskMode: "ambient" },
});
vm.runInNewContext(gothicPayload, gothic.context);
assert.equal(gothic.rootStyles.get("--dream-accent"), "#c8a55a");
assert.equal(gothic.rootStyles.get("--dream-canvas"), "#0d0d0e");
assert.equal(gothic.rootStyles.get("--dream-surface"), "#171513");
assert.equal(gothic.rootStyles.get("--dream-surface-raised"), "#211d18");
assert.equal(gothic.rootStyles.get("--dream-text"), "#f3ead7");
assert.equal(gothic.rootStyles.get("--dream-text-muted"), "#b5a386");
// Accent ink is derived from the configured accent color, not image analysis RGB.
assert.match(gothic.rootStyles.get("--dream-accent-ink"), /^rgb\(/);
for (const [nativeProperty, expectedValue] of [
  ["--color-token-bg-primary", "#0d0d0e"],
  ["--color-token-main-surface-primary", "#171513"],
  ["--color-token-side-bar-background", "#171513"],
  ["--vscode-editor-background", "#171513"],
  ["--vscode-panel-background", "#171513"],
  ["--vscode-input-background", "color-mix(in oklab, #211d18 72%, transparent)"],
  ["--vscode-foreground", "#f3ead7"],
  ["--vscode-descriptionForeground", "#b5a386"],
  ["--vscode-input-border", "rgba(200, 165, 90, .28)"],
  ["--vscode-focusBorder", "#c8a55a"],
  ["--color-token-charts-blue", "#c8a55a"],
  ["--color-background-surface-under", "#0d0d0e"],
  ["--color-background-surface", "#171513"],
  ["--color-background-panel", "color-mix(in oklab, #211d18 72%, transparent)"],
  ["--color-background-control-opaque", "#211d18"],
  ["--color-text-foreground", "#f3ead7"],
  ["--color-text-foreground-secondary", "#b5a386"],
  ["--color-border", "rgba(200, 165, 90, .28)"],
  ["--color-text-accent", "#c8a55a"],
]) {
  assert.equal(
    gothic.rootStyles.get(nativeProperty),
    expectedValue,
    `Gothic colors{} must map ${nativeProperty} to its native token value.`,
  );
}
assert.equal(
  gothic.rootPriorities.get("--color-background-panel"),
  "important",
  "The current Codex semantic palette uses !important and must be bridged at equal priority.",
);
assert.equal(configured.routeClasses.has("dream-task"), false);
assert.equal(configured.utilityClasses.has("dream-home-utility"), true);
assert.equal(configured.context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);
assert.equal(configured.utilityClasses.has("dream-home-utility"), false);
assert.equal(gothic.context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);
for (const nativeProperty of [
  "--color-token-bg-primary",
  "--color-token-main-surface-primary",
  "--vscode-editor-background",
  "--vscode-foreground",
  "--vscode-input-background",
  "--vscode-descriptionForeground",
  "--vscode-input-border",
  "--vscode-focusBorder",
  "--color-token-charts-blue",
  "--color-background-panel",
  "--color-background-surface",
  "--color-text-foreground",
  "--color-border",
]) {
  assert.equal(
    gothic.rootStyles.has(nativeProperty),
    false,
    `cleanup() must remove native theme property ${nativeProperty}.`,
  );
}
assert.equal(gothic.rootPriorities.has("--color-background-panel"), false);

const gothicDark = createFixture({ shellPresent: true, shellAppearance: "dark" });
vm.runInNewContext(gothicPayload, gothicDark.context);
for (const [property, expectedValue] of [
  ["--dream-task-immersive-sidebar", "color-mix(in oklab, #171513 70%, transparent)"],
  ["--dream-task-immersive-edge", "color-mix(in oklab, #0d0d0e 82%, transparent)"],
  ["--dream-task-immersive-mid", "color-mix(in oklab, #0d0d0e 74%, transparent)"],
  ["--dream-task-immersive-far", "color-mix(in oklab, #0d0d0e 60%, transparent)"],
  ["--vscode-input-background", "color-mix(in oklab, #211d18 44%, transparent)"],
  ["--color-background-panel", "color-mix(in oklab, #211d18 44%, transparent)"],
]) {
  assert.equal(
    gothicDark.rootStyles.get(property),
    expectedValue,
    `Dark Gothic colors{} must preserve the macOS wash value for ${property}.`,
  );
}
assert.equal(gothicDark.context.window.__CODEX_DREAM_SKIN_STATE__.cleanup(), true);

// Current Codex Windows builds no longer expose data-testid="home-icon".
// The semantic game-source marker must still classify the new-task route as
// home so its utility bar and composer share one themed surface.
const modernHome = createFixture({
  shellPresent: true,
  modernHomePresent: true,
  roleMainPresent: false,
  utilityPresent: true,
});
vm.runInNewContext(payload, modernHome.context);
assert.equal(modernHome.routeClasses.has("dream-home"), true);
assert.equal(modernHome.routeClasses.has("dream-task"), false);
assert.equal(modernHome.utilityClasses.has("dream-home-utility"), true);

// Keep the same semantic fallback as macOS when Codex changes the named
// Windows container token but retains both native home markers.
const semanticHome = createFixture({
  shellPresent: true,
  semanticHomePresent: true,
  utilityPresent: true,
});
vm.runInNewContext(payload, semanticHome.context);
assert.equal(semanticHome.routeClasses.has("dream-home"), true);
assert.equal(semanticHome.routeClasses.has("dream-task"), false);
assert.equal(semanticHome.utilityClasses.has("dream-home-utility"), true);

// Settings has no role=main, so the persistent shell temporarily owns the
// task marker. Returning home must remove that stale marker from the shell.
const settingsToHome = createFixture({
  shellPresent: true,
  roleMainPresent: false,
});
vm.runInNewContext(payload, settingsToHome.context);
assert.equal(settingsToHome.shellClasses.has("dream-task"), true);
settingsToHome.setModernHomePresent(true);
settingsToHome.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(settingsToHome.routeClasses.has("dream-home"), true);
assert.equal(settingsToHome.shellClasses.has("dream-task"), false);

const analysisPixels = new Uint8ClampedArray(48 * 12 * 4);
for (let index = 0; index < 48 * 12; index += 1) {
  const offset = index * 4;
  const x = index % 48;
  const subject = x >= 34 && x <= 42;
  analysisPixels[offset] = subject ? 210 : 246;
  analysisPixels[offset + 1] = subject ? 84 : 239;
  analysisPixels[offset + 2] = subject ? 112 : 237;
  analysisPixels[offset + 3] = 255;
}
const analyzed = createFixture({
  shellPresent: true,
  analysisFixture: { naturalWidth: 1200, naturalHeight: 400, pixels: analysisPixels },
});
vm.runInNewContext(payload, analyzed.context);
await Promise.resolve();
assert.equal(analyzed.rootClasses.has("dream-theme-dark"), true);
assert.equal(analyzed.rootClasses.has("dream-theme-light"), false);
assert.equal(analyzed.rootClasses.has("dream-art-wide"), true);
assert.equal(analyzed.rootClasses.has("dream-task-banner"), true);
assert.equal(analyzed.rootClasses.has("dream-safe-left"), true);
assert.notEqual(analyzed.rootStyles.get("--dream-accent"), "rgb(216 104 119)");

const standardArt = createFixture({
  shellPresent: true,
  analysisFixture: { naturalWidth: 800, naturalHeight: 800, pixels: analysisPixels },
});
vm.runInNewContext(payload, standardArt.context);
await Promise.resolve();
assert.equal(standardArt.rootClasses.has("dream-art-standard"), true);
assert.equal(standardArt.rootClasses.has("dream-task-ambient"), true);
assert.equal(standardArt.rootClasses.has("dream-task-banner"), false);

const mediumWide = createFixture({
  shellPresent: true,
  analysisFixture: { naturalWidth: 2100, naturalHeight: 1000, pixels: analysisPixels },
});
vm.runInNewContext(payload, mediumWide.context);
await Promise.resolve();
assert.equal(mediumWide.rootClasses.has("dream-art-wide"), true);
assert.equal(mediumWide.rootClasses.has("dream-task-ambient"), true);
assert.equal(mediumWide.rootClasses.has("dream-task-banner"), false);

const nativeLight = createFixture({ shellPresent: true, shellAppearance: "light" });
vm.runInNewContext(payload, nativeLight.context);
assert.equal(nativeLight.rootClasses.has("dream-theme-light"), true);
assert.equal(nativeLight.rootClasses.has("dream-theme-dark"), false);

const nativeComputedDark = createFixture({
  shellPresent: true,
  shellAppearance: "",
  computedColorScheme: "dark",
  osAppearance: "light",
});
vm.runInNewContext(payload, nativeComputedDark.context);
assert.equal(nativeComputedDark.rootClasses.has("dream-theme-dark"), true);
assert.equal(nativeComputedDark.rootClasses.has("dream-theme-light"), false);
nativeComputedDark.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(nativeComputedDark.rootClasses.has("dream-theme-dark"), true);
const nativeObserver = nativeComputedDark.observers[0];
nativeObserver.takeRecords();
nativeComputedDark.context.window.__CODEX_DREAM_SKIN_STATE__.ensure();
assert.equal(nativeObserver.takeRecords().length, 0,
  "Sampling the native computed color-scheme must not queue a self-triggering root mutation pass.");

const metadataWide = createFixture({ shellPresent: true });
vm.runInNewContext(buildPayload({ artMetadata: { ratio: 16 / 9 } }), metadataWide.context);
assert.equal(metadataWide.rootClasses.has("dream-art-wide"), true);
assert.equal(metadataWide.rootClasses.has("dream-art-standard"), false);

console.log("PASS: renderer applies adaptive theme metadata, keeps skin without a sidebar, and preserves transparent auxiliary windows.");
