import { currentInfobar, registerInfobar, registerPlayerAction, toggleInfoBar } from "@omniplayr/plugins";
import { MonitorSpeaker } from "lucide-react";
import Devices from "./Devices";
import { initDevice } from "./device";
import { initGoogleCastOutput } from "./castOutput";
import { initRemoteOutput } from "./remoteOutput";
import translations from './translations';

const plugin_key = "devices@built-in";

initDevice();
initGoogleCastOutput();
initRemoteOutput();

registerInfobar(plugin_key, { barId: 'devices', view: Devices, mobile: 'partial' });

registerPlayerAction(plugin_key, {
    id: 'devices',
    icon: MonitorSpeaker,
    label: () => translations.t('devices.title'),
    showInPlayer: true,
    active: () => currentInfobar()?.id === plugin_key,
    action: () => toggleInfoBar(plugin_key, 'devices'),
});

export default translations;
