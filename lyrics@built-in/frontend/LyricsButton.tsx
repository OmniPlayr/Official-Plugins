import { useEffect, useState } from "react";
import { MicVocal } from "lucide-react";
import { currentInfobar, on, toggleInfoBar } from "@omniplayr/plugins";
import "./styles/LyricsButton.css";

const LYRICS_PLUGIN_ID = "lyrics@built-in";
const LYRICS_BAR_ID = "lyrics";

function LyricsButton() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        setVisible(currentInfobar()?.id === LYRICS_PLUGIN_ID);
        return on("infobar:updated", (infobar) => {
            setVisible(infobar?.id === LYRICS_PLUGIN_ID);
        });
    }, []);

    return (
        <button
            className={`lyrics-button${visible ? " active" : ""}`}
            type="button"
            onClick={() => toggleInfoBar(LYRICS_PLUGIN_ID, LYRICS_BAR_ID)}
            aria-pressed={visible}
            aria-label="Toggle lyrics"
        >
            <MicVocal className="lyrics-button-icon" />
        </button>
    );
}

export default LyricsButton;