import { useEffect, useState } from "react";
import "./styles/LyricsButton.css";
import { getLyricsVisibleState, subscribeLyricsVisibleState, toggleLyricsVisibleState } from "./lyricsState";
import { MicVocal } from "lucide-react";

function LyricsButton() {
    const [ visible, setVisible ] = useState(getLyricsVisibleState);

    useEffect(() => subscribeLyricsVisibleState(setVisible), []);

    return (
        <button
            className={`lyrics-button${visible ? ' active' : ''}`}
            type="button"
            onClick={() => setVisible(toggleLyricsVisibleState())}
            aria-pressed={visible}
            aria-label="Toggle lyrics"
        >
            <MicVocal className="lyrics-button-icon" />
        </button>
    );
}

export default LyricsButton;
