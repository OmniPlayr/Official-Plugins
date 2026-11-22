import { createRoot, type Root } from "react-dom/client";
import Queue from "./Queue";
import { modify, registerInfobar } from "@omniplayr/plugins";
import QueueButton from "./QueueButton";
import translations from './translations';
import NextQueue from "./NextQueue";

const plugin_key = "queued@built-in";

const roots = new WeakMap<Element, Root>();
type RootContainer = Element & {
    __omniplayrReactRoot?: Root;
};

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

modify(plugin_key, 'Player.plugin-target-before-volume-option', el => {
    el.setAttribute("data-plugin-hooked", "");

    const container = getSideTabButtonSlot(el, "queue-button-plugin-root", 2);

    const root = getRoot(container);

    if (root) {
        root.render(<QueueButton />);
    }
});

modify(plugin_key, 'Infobar.ib-song-more-info', (el, mount) => {
    if (!mount) return;

    const root = getRoot(mount);
    root?.render(<NextQueue/>);
}, {
    position: 'end'
});

registerInfobar(plugin_key, { barId: 'queued', view: Queue })

export default translations;
export {
    getQueueVisibleState,
    readStoredQueueWidth,
    setQueueVisibleState,
    setSideTabWidth,
    subscribeQueueVisibleState,
    subscribeSideTabWidth,
    toggleQueueVisibleState,
} from "./queueState";
