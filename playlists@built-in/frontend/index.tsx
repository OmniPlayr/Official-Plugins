import { createRoot, type Root } from "react-dom/client";
import Home from "./Home";
import Playlist from "./Playlist";

import {
    modify,
    registerRoute,
    definePluginTranslations,
} from "@omniplayr/plugins";
import Playlists from "./Playlists";

const plugin_key = "playlists@built-in";

const roots = new WeakMap<Element, Root>();

const translations = definePluginTranslations(plugin_key);

modify(plugin_key, 'Dashboard.dashboard-home', el => {
    el.setAttribute("data-plugin-hooked", "");

    let container = el.querySelector(":scope > .__plugin-hook-wrapper");

    if (!container) {
        container = document.createElement("div");
        container.className = "__plugin-hook-wrapper";
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