# devices@built-in

View and switch playback between OmniPlayr devices.

**Versions:** Backend `1.0.0` | Frontend `1.2.0`

`devices@built-in` registers the current client with the server, shows online account devices in the InfoBar, and lets the player move playback to another OmniPlayr client. It also exposes local Google Cast devices in the frontend without sending local-network discovery results to the server.

## Features

- Opens from Track actions or the desktop player shortcut. The device InfoBar uses a partial sheet on mobile.
- Shows online, idle, and unavailable devices for the current account.
- Marks the current device and keeps it at the top of the device list.
- Disconnects the current device when the page closes or refreshes.
- Reuses reliable device identifiers so the same non-browser device appears only once.
- Uses a per-tab browser identifier so refreshes reuse the same browser device while separate tabs can still appear separately.
- Sends playback commands to another OmniPlayr client for play, pause, resume, seek, next, previous, shuffle, repeat, stop, and volume.
- Provides Google Cast output support for streamable sources.
- Polls the devices list on a configurable interval.
- Includes English and Dutch frontend translations.

## Configuration

Backend settings:

- `devices.heartbeat_interval`: how often clients refresh their online status.

Frontend settings (requires OmniPlayr dev `2026.11.10` or newer):

- `devices.refresh_interval`: how often the device list refetches while visible.
- `devices.command_poll_interval`: how often a registered client checks for remote commands.

## Notes

Spotify cannot be cast through Google Cast from the browser because the Spotify Web Playback SDK does not expose a castable audio stream. Spotify playback can still be transferred between OmniPlayr clients when both clients have the Spotify integration available.

Google Cast discovery is frontend-only because cast devices are only visible on the user's local network.
