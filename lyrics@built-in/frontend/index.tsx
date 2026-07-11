import { definePluginTranslations, modify } from "@omniplayr/plugins";
import { createRoot, type Root } from "react-dom/client";
import LyricsView from "./LyricsView";
import LyricsButton from "./LyricsButton";

const plugin_key = "lyrics@built-in";

const roots = new WeakMap<Element, Root>();
const translations = definePluginTranslations(plugin_key);

function getSideTabButtonSlot(el: Element, className: string, order: number) {
    let group = el.querySelector(
        ":scope > .__plugin-hook-wrapper.sidetab-button-plugin-root"
    );

    if (!group) {
        group = document.createElement("div");
        group.className = "__plugin-hook-wrapper sidetab-button-plugin-root";
        el.appendChild(group);
    }

    let container = group.querySelector(`:scope > .${className}`);

    if (!container) {
        container = document.createElement("div");
        container.className = `sidetab-button-slot ${className}`;
        group.appendChild(container);
    }

    (container as HTMLElement).style.order = String(order);
    return container;
}

modify(plugin_key, 'Dashboard.dashboard-hor', el => {
    el.setAttribute("data-plugin-hooked", "");

    let container = el.querySelector(
        ":scope > .__plugin-hook-wrapper.lyrics-plugin-root"
    );

    if (!container) {
        container = document.createElement("div");
        container.className = "__plugin-hook-wrapper lyrics-plugin-root";
        el.appendChild(container);
    }

    let root = roots.get(container);

    if (!root) {
        try {
            root = createRoot(container);
            roots.set(container, root);
        } catch (e) {
            console.error('Failed to create root for plugin', plugin_key, e);
        }
    }

    if (root) {
        root.render(<LyricsView />);
    }
});

modify(plugin_key, 'Player.plugin-target-before-volume-option', el => {
    el.setAttribute("data-plugin-hooked", "");

    const container = getSideTabButtonSlot(el, "lyrics-button-plugin-root", 1);

    let root = roots.get(container);

    if (!root) {
        try {
            root = createRoot(container);
            roots.set(container, root);
        } catch (e) {
            console.error('Failed to create root for plugin', plugin_key, e);
        }
    }

    if (root) {
        root.render(<LyricsButton />);
    }
});

export default translations;
export {
    getLyricsVisibleState,
    readStoredSideTabWidth,
    setLyricsVisibleState,
    setSideTabWidth,
    subscribeLyricsVisibleState,
    subscribeSideTabWidth,
    toggleLyricsVisibleState,
} from "./lyricsState";
