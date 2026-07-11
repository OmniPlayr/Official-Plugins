import { player, type QueueItem } from '@omniplayr/plugins';

export function queueSignature(queueName: string | null, items: QueueItem[], visibleLimit: number) {
    return JSON.stringify({
        queueName,
        visibleLimit,
        currentSongId: player.currentSongId,
        currentSourceType: player.currentSourceType,
        currentTitle: player.currentMetadata?.title ?? null,
        currentArtist: player.currentMetadata?.artist ?? null,
        currentFilename: player.currentMetadata?.filename ?? null,
        currentAlbumArt: player.currentMetadata?.album_art ?? null,
        currentPlaylistService: player.currentExtra?.playlistService ?? null,
        currentPlaylistId: player.currentExtra?.playlistId ?? null,
        currentPlaylistName: player.currentExtra?.playlistName ?? null,
        items: items.map((item) => ({
            songId: item.songId,
            sourceType: item.sourceType,
            title: item.extra?.title ?? null,
            artist: item.extra?.artist ?? null,
            albumArt: item.extra?.albumArt ?? item.extra?.album_art ?? null,
            playlistService: item.extra?.playlistService ?? null,
            playlistId: item.extra?.playlistId ?? null,
            playlistName: item.extra?.playlistName ?? null,
            playlistPosition: item.extra?.playlistPosition ?? null,
        })),
    });
}
