import { createRoot, type Root } from "react-dom/client";
import Queue from "./Queue";
import { currentInfobar, modify, registerInfobar, registerPlayerAction, toggleInfoBar } from "@omniplayr/plugins";
import { List } from "lucide-react";
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

modify(plugin_key, 'Infobar.ib-song-more-info', (el, mount) => {
    if (!mount) return;

    const root = getRoot(mount);
    root?.render(<NextQueue/>);
}, {
    position: 'end'
});

registerInfobar(plugin_key, { barId: 'queued', view: Queue, mobile: 'partial' });

registerPlayerAction(plugin_key, {
    id: 'queue',
    icon: List,
    label: () => translations.t('queue.queue'),
    showInPlayer: true,
    active: () => currentInfobar()?.id === plugin_key,
    action: () => toggleInfoBar(plugin_key, 'queued'),
});

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
