import { useEffect, useState } from "react";
import { List } from "lucide-react";
import { currentInfobar, on, toggleInfoBar } from "@omniplayr/plugins";
import "./styles/QueueButton.css";

const QUEUE_PLUGIN_ID = "queued@built-in";
const QUEUE_BAR_ID = "queue";

function QueueButton() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        setVisible(currentInfobar()?.id === QUEUE_PLUGIN_ID);
        return on("infobar:updated", (infobar) => {
            setVisible(infobar?.id === QUEUE_PLUGIN_ID);
        });
    }, []);

    return (
        <button
            className={`queue-button${visible ? " active" : ""}`}
            type="button"
            onClick={() => toggleInfoBar(QUEUE_PLUGIN_ID, QUEUE_BAR_ID)}
            aria-pressed={visible}
            aria-label="Toggle queue"
        >
            <List className="queue-button-icon" />
        </button>
    );
}

export default QueueButton;