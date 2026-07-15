import { modify, useIsMobile } from "@omniplayr/plugins";
import { createRoot, type Root } from "react-dom/client";
import LyricsView from "./LyricsView";
import LyricsButton from "./LyricsButton";
import translations from './translations';

const plugin_key = "lyrics@built-in";

const roots = new WeakMap<Element, Root>();
let desktopLyricsRoot: Root | null = null;
let mobileLyricsRoot: Root | null = null;
let resizeFrame: number | null = null;
type RootContainer = Element & {
    __omniplayrReactRoot?: Root;
};

function DesktopLyricsView() {
    const isMobile = useIsMobile();

    if (isMobile) return null;

    return <LyricsView />;
}

function MobileLyricsView() {
    const isMobile = useIsMobile();

    if (!isMobile) return null;

    return <LyricsView />;
}

function getRoot(container: Element) {
    const rootContainer = container as RootContainer;
    let root = rootContainer.__omniplayrReactRoot ?? roots.get(container);

    if (!root) {
        try {
            root = createRoot(container);
            rootContainer.__omniplayrReactRoot = root;
            roots.set(container, root);
        } catch (e) {
            console.error('Failed to create root for plugin', plugin_key, e);
        }
    }

    return root;
}

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

    desktopLyricsRoot = getRoot(container) ?? null;
    desktopLyricsRoot?.render(<DesktopLyricsView />);
});

function mountMobileLyrics() {
    const el = document.querySelector('[data-component="Player-Fullscreen"], .Player-Fullscreen');

    if (!el) return false;

    let container = el.querySelector(
        ":scope > .__plugin-hook-wrapper.lyrics-mobile-plugin-root"
    );

    if (!container) {
        container = document.createElement("div");
        container.className = "__plugin-hook-wrapper lyrics-mobile-plugin-root";
        el.appendChild(container);
    }

    mobileLyricsRoot = getRoot(container) ?? null;
    mobileLyricsRoot?.render(<MobileLyricsView />);

    return true;
}

modify(plugin_key, 'Player.Player-Fullscreen', el => {
    let container = el.querySelector(
        ":scope > .__plugin-hook-wrapper.lyrics-mobile-plugin-root"
    );

    if (!container) {
        container = document.createElement("div");
        container.className = "__plugin-hook-wrapper lyrics-mobile-plugin-root";
        el.appendChild(container);
    }

    mobileLyricsRoot = getRoot(container) ?? null;
    mobileLyricsRoot?.render(<MobileLyricsView />);
});

if (!mountMobileLyrics()) {
    const observer = new MutationObserver(() => {
        if (mountMobileLyrics()) {
            observer.disconnect();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}

function rerenderLyricsViews() {
    if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
    }

    resizeFrame = requestAnimationFrame(() => {
        desktopLyricsRoot?.render(<DesktopLyricsView />);

        if (!mobileLyricsRoot) {
            mountMobileLyrics();
        } else {
            mobileLyricsRoot.render(<MobileLyricsView />);
        }

        resizeFrame = null;
    });
}

window.addEventListener("resize", rerenderLyricsViews);

modify(plugin_key, 'Player.plugin-target-before-volume-option', el => {
    el.setAttribute("data-plugin-hooked", "");

    const container = getSideTabButtonSlot(el, "lyrics-button-plugin-root", 1);
    const root = getRoot(container);

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
