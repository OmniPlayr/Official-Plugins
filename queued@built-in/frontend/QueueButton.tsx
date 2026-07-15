import { useEffect, useState } from "react";
import { List } from "lucide-react";
import "./styles/QueueButton.css";
import { getQueueVisibleState, subscribeQueueVisibleState, toggleQueueVisibleState } from "./queueState";

function QueueButton() {
    const [ visible, setVisible ] = useState(getQueueVisibleState);

    useEffect(() => subscribeQueueVisibleState(setVisible), []);

    return (
        <button
            className={`queue-button${visible ? ' active' : ''}`}
            type="button"
            onClick={() => setVisible(toggleQueueVisibleState())}
            aria-pressed={visible}
            aria-label="Toggle queue"
        >
            <List className="queue-button-icon" />
        </button>
    )
}

export default QueueButton
