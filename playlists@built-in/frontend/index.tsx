import { createRoot, type Root } from "react-dom/client";
import Home from "./Home";
import Playlist from "./Playlist";

import {
    modify,
    registerRoute,
} from "@omniplayr/plugins";
import Playlists from "./Playlists";
import translations from './translations';

const plugin_key = "playlists@built-in";

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

modify(plugin_key, 'Dashboard.dashboard-home', el => {
    el.setAttribute("data-plugin-hooked", "");

    let container = el.querySelector(":scope > .__plugin-hook-wrapper");

    if (!container) {
        container = document.createElement("div");
        container.className = "__plugin-hook-wrapper";
        el.appendChild(container);
    }

    const root = getRoot(container);

    if (root) {
        root.render(<Home />);
    }
});

registerRoute({
    path: "/playlist/:id",
    component: Playlist,
})

registerRoute({
    path: "/playlists/:service",
    component: Playlists,
})

export default translations;
