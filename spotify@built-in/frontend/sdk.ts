import { makeToast } from '@wokki20/jspt';
import { getValidToken } from './auth';
import api from '../../modules/api';
import { useEffect, useState } from 'react';

declare global {
    interface Window {
        Spotify: any;
        onSpotifyWebPlaybackSDKReady: () => void;
    }
}

type StateListener = (state: any | null) => void;

let sdkPlayer: any = null;
let deviceId: string | null = null;
let currentState: any = null;
let stateListeners = new Set<StateListener>();
let readyResolve: (() => void) | null = null;
let readyPromise = new Promise<void>(r => { readyResolve = r; });
let volumeInterval: ReturnType<typeof setInterval> | null = null;

async function loadAccount() {
    return await api("get_account", undefined, { account_id: "me" }) as any;
}

function resetReady() {
    readyPromise = new Promise<void>(r => { readyResolve = r; });
}

function notifyState(state: any | null) {
    currentState = state;
    stateListeners.forEach(cb => cb(state));
}

export function onStateChange(cb: StateListener): () => void {
    stateListeners.add(cb);
    return () => stateListeners.delete(cb);
}

export function getState() { return currentState; }
export function getDeviceId() { return deviceId; }
export function waitReady() { return readyPromise; }

export async function loadSdk() {
    if (document.getElementById('spotify-sdk')) return;
    const account = await loadAccount();
    const name = account?.name;

    if (
        window.location.protocol === 'http:' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
    ) {
        makeToast({
            message: 'Spotify SDK requires HTTPS. Please reload this page over HTTPS.',
            style: 'default-error',
            duration: 5000
        })
        return;
    } else if (
        window.location.protocol === 'http:' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ) {
        makeToast({
            message: 'Running on localhost over HTTP is allowed, but Spotify features may still require HTTPS in production.',
            style: 'default-error',
            duration: 5000
        })
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
        sdkPlayer = new window.Spotify.Player({
            name: 'OmniPlayr • ' + name,
            getOAuthToken: async (cb: (t: string) => void) => {
                const t = await getValidToken();
                if (t) cb(t);
            },
            volume: 1,
        });
        (window as any).sdkPlayer = sdkPlayer;

        sdkPlayer.addListener('ready', ({ device_id }: { device_id: string }) => {
            deviceId = device_id;
            readyResolve?.();
        });

        sdkPlayer.addListener('not_ready', () => {
            deviceId = null;
            resetReady();
        });

        sdkPlayer.addListener('player_state_changed', notifyState);

        sdkPlayer.connect();
    };

    const script = document.createElement('script');
    script.id = 'spotify-sdk';
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(script);
}

export async function sdkPlay(trackId: string) {
    await waitReady();
    const token = await getValidToken();
    if (!token || !deviceId) throw new Error('Spotify not ready');

    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
    });

    if (!res.ok && res.status !== 204) {
        throw new Error(`Spotify play failed: ${res.status}`);
    }
}

export function sdkPause() { sdkPlayer?.pause(); }
export function sdkResume() { sdkPlayer?.resume(); }
export function sdkSeek(ms: number) { sdkPlayer?.seek(ms); }
export function sdkSetVolume(fraction: number) { sdkPlayer?.setVolume(fraction); }

export function startVolumePolling(onChange: (v: number) => void, sdkPlayer: any) {
    if (volumeInterval) return;

    let last = -1;

    volumeInterval = setInterval(async () => {
        const v = await sdkPlayer.getVolume();

        if (v !== last) {
            last = v;
            onChange(v);
        }
    }, 1000);
}

export function stopVolumePolling() {
    if (volumeInterval) {
        clearInterval(volumeInterval);
        volumeInterval = null;
    }
}
export function sdkDisconnect() {
    sdkPlayer?.disconnect();
    sdkPlayer = null;
    deviceId = null;
    currentState = null;
    resetReady();
}