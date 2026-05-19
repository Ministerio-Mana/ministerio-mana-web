const PLAYER_SELECTOR = '[data-youtube-footer-player]';
const OPEN_PLAYLIST_SELECTOR = '[data-youtube-playlist-panel]:not([hidden])';

function buildEmbedUrl(videoId) {
  const params = new URLSearchParams({
    autoplay: '1',
    controls: '1',
    fs: '0',
    iv_load_policy: '3',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    origin: window.location.origin,
    widget_referrer: window.location.origin,
  });

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function getPlayer(target) {
  return target?.closest?.(PLAYER_SELECTOR) ?? null;
}

function setPlayLabel(player, isPlaying) {
  const label = player.querySelector('[data-youtube-toggle-label]');
  const toggle = player.querySelector('[data-youtube-toggle]');
  const playLabel = player.getAttribute('data-play-label') || 'Reproducir';
  const pauseLabel = player.getAttribute('data-pause-label') || 'Pausar';

  if (label) label.textContent = isPlaying ? pauseLabel : playLabel;
  toggle?.setAttribute('aria-expanded', String(isPlaying));
  toggle?.setAttribute('aria-label', isPlaying ? pauseLabel : playLabel);
  player.setAttribute('data-playing', String(isPlaying));
}

function closePlaylist(player) {
  const panel = player?.querySelector('[data-youtube-playlist-panel]');
  const toggle = player?.querySelector('[data-youtube-playlist-toggle]');
  if (!panel || !toggle) return;

  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}

function closeOtherPlaylists(exceptPlayer = null) {
  document.querySelectorAll(OPEN_PLAYLIST_SELECTOR).forEach((panel) => {
    const player = panel.closest(PLAYER_SELECTOR);
    if (player && player === exceptPlayer) return;
    closePlaylist(player);
  });
}

function playVideo(player) {
  const videoId = player?.getAttribute('data-video-id');
  const frame = player?.querySelector('[data-youtube-frame]');
  const frameShell = player?.querySelector('[data-youtube-frame-shell]');
  if (!player || !videoId || !frame || !frameShell) return;

  frame.setAttribute('src', buildEmbedUrl(videoId));
  frameShell.hidden = false;
  setPlayLabel(player, true);
}

function pauseVideo(player) {
  const frame = player?.querySelector('[data-youtube-frame]');
  const frameShell = player?.querySelector('[data-youtube-frame-shell]');
  if (!player) return;

  frame?.removeAttribute('src');
  if (frameShell) frameShell.hidden = true;
  setPlayLabel(player, false);
}

function selectVideo(option) {
  const player = getPlayer(option);
  const videoId = option.getAttribute('data-video-id');
  if (!player || !videoId) return;

  const title = player.querySelector('[data-youtube-title]');
  const description = player.querySelector('[data-youtube-description]');
  const thumb = player.querySelector('[data-youtube-thumb]');

  player.setAttribute('data-video-id', videoId);
  if (title) title.textContent = option.getAttribute('data-video-title') || '';
  if (description) description.textContent = option.getAttribute('data-video-description') || '';
  if (thumb) thumb.setAttribute('src', option.getAttribute('data-video-image') || '');

  closePlaylist(player);
  playVideo(player);
}

function togglePlaylist(toggle) {
  const player = getPlayer(toggle);
  const panel = player?.querySelector('[data-youtube-playlist-panel]');
  if (!player || !panel) return;

  const shouldOpen = panel.hidden;
  closeOtherPlaylists(player);
  panel.hidden = !shouldOpen;
  toggle.setAttribute('aria-expanded', String(shouldOpen));
}

function handleDocumentClick(event) {
  const target = event.target;
  const option = target?.closest?.('[data-youtube-option]');
  const playToggle = target?.closest?.('[data-youtube-toggle]');
  const playlistToggle = target?.closest?.('[data-youtube-playlist-toggle]');

  if (option) {
    event.preventDefault();
    event.stopPropagation();
    selectVideo(option);
    return;
  }

  if (playToggle) {
    event.preventDefault();
    event.stopPropagation();
    const player = getPlayer(playToggle);
    closePlaylist(player);
    if (player?.getAttribute('data-playing') === 'true') {
      pauseVideo(player);
    } else {
      playVideo(player);
    }
    return;
  }

  if (playlistToggle) {
    event.preventDefault();
    event.stopPropagation();
    togglePlaylist(playlistToggle);
    return;
  }

  if (!target?.closest?.(PLAYER_SELECTOR)) closeOtherPlaylists();
}

function syncPlayers() {
  document.querySelectorAll(PLAYER_SELECTOR).forEach((player) => {
    const frame = player.querySelector('[data-youtube-frame]');
    const frameShell = player.querySelector('[data-youtube-frame-shell]');
    const isPlaying = player.getAttribute('data-playing') === 'true' && Boolean(frame?.getAttribute('src'));

    if (frameShell && !isPlaying) frameShell.hidden = true;
    setPlayLabel(player, isPlaying);
    closePlaylist(player);
  });
}

document.documentElement.dataset.manaFooterPlayerScript = 'delegated';

if (!window.__manaYoutubeFooterDelegated) {
  window.__manaYoutubeFooterDelegated = true;
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOtherPlaylists();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', syncPlayers, { once: true });
} else {
  syncPlayers();
}

window.addEventListener('load', syncPlayers, { once: true });
document.addEventListener('astro:page-load', syncPlayers);
document.addEventListener('astro:after-swap', syncPlayers);
