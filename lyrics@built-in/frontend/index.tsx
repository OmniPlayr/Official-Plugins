import { currentInfobar, modify, registerInfobar, registerPlayerAction, registerRoute, toggleInfoBar } from "@omniplayr/plugins";
import { createRoot, type Root } from "react-dom/client";
import LyricsView from "./LyricsView";
import { MicVocal } from "lucide-react";
import translations from './translations';
import InfobarPreview from "./InfobarPreview";
import LyricsFull from "./LyricsFull";

const plugin_key = "lyrics@built-in";

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
    root?.render(<InfobarPreview/>);
}, {
    position: 'start'
});

registerRoute({
    path: '/lyrics',
    component: LyricsFull,
});

registerInfobar(plugin_key, { barId: 'lyrics', view: () => <LyricsView fullInfoBar />, mobile: 'full' });

registerPlayerAction(plugin_key, {
    id: 'lyrics',
    icon: MicVocal,
    label: () => translations.t('lyrics.action'),
    showInPlayer: true,
    active: () => currentInfobar()?.id === plugin_key,
    action: () => toggleInfoBar(plugin_key, 'lyrics'),
});

export default translations;
export {
    getLyricsVisibleState,
    setLyricsVisibleState,
    subscribeLyricsVisibleState,
    toggleLyricsVisibleState,
} from "./lyricsState";
