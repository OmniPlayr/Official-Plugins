import { createRoot, type Root } from "react-dom/client";
import Home from "./Home";
import Playlist from "./Playlist";

import {
    modify,
    registerRoute,
    definePluginTranslations,
} from "@omniplayr/plugins";

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
        root = createRoot(container);
        roots.set(container, root);
    }

    root.render(<Home />);
});

registerRoute({
    path: "/playlist/:id",
    component: Playlist,
})

export default translations;