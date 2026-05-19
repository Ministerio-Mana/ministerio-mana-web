const PLAYER_SELECTOR = '[data-youtube-footer-player]';
const OPEN_PLAYLIST_SELECTOR = '[data-youtube-playlist-panel]:not([hidden])';
const YOUTUBE_IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
const SEEK_STEP_SECONDS = 10;

let youtubeApiPromise;
let playerId = 0;
let activeSeek = null;

const playerStates = new WeakMap();

function buildEmbedUrl(videoId, autoplay = false) {
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    controls: '0',
    disablekb: '1',
    enablejsapi: '1',
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = String(rounded % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function getPlayer(target) {
  return target?.closest?.(PLAYER_SELECTOR) ?? null;
}

function getPlayerState(player) {
  if (!playerStates.has(player)) {
    playerStates.set(player, {
      currentTime: 0,
      duration: 0,
      isSeeking: false,
      pendingPlay: false,
      progressTimer: null,
      readyPromise: null,
      videoId: '',
      ytPlayer: null,
    });
  }

  return playerStates.get(player);
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

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube IFrame API did not load.'));
      }
    }, 10000);

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === 'function') previousReady();
      window.clearTimeout(timeout);
      resolve(window.YT);
    };

    if (document.querySelector(`script[src="${YOUTUBE_IFRAME_API_URL}"]`)) return;

    const script = document.createElement('script');
    script.src = YOUTUBE_IFRAME_API_URL;
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('YouTube IFrame API failed to load.'));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    youtubeApiPromise = null;
    throw error;
  });

  return youtubeApiPromise;
}

function updateProgress(player, currentTime = 0, duration = 0) {
  const state = getPlayerState(player);
  const track = player.querySelector('[data-youtube-progress]');
  const fill = player.querySelector('[data-youtube-progress-fill]');
  const time = player.querySelector('[data-youtube-time]');
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrent = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
  const percent = safeDuration > 0 ? clamp((safeCurrent / safeDuration) * 100, 0, 100) : 0;
  const timeLabel = `${formatTime(safeCurrent)} / ${safeDuration ? formatTime(safeDuration) : '0:00'}`;

  state.currentTime = safeCurrent;
  state.duration = safeDuration;
  fill?.style.setProperty('--mana-progress', `${percent}%`);
  track?.setAttribute('aria-valuenow', String(Math.round(percent)));
  track?.setAttribute('aria-valuetext', timeLabel);
  if (time) time.textContent = timeLabel;
}

function updateProgressFromYouTube(player) {
  const state = getPlayerState(player);
  if (!state.ytPlayer || state.isSeeking) return;

  try {
    const duration = state.ytPlayer.getDuration?.() ?? state.duration;
    const currentTime = state.ytPlayer.getCurrentTime?.() ?? state.currentTime;
    updateProgress(player, currentTime, duration);
  } catch {
    // YouTube can briefly reject reads while changing videos; the next tick will resync.
  }
}

function startProgressTimer(player) {
  const state = getPlayerState(player);
  if (state.progressTimer) return;

  updateProgressFromYouTube(player);
  state.progressTimer = window.setInterval(() => updateProgressFromYouTube(player), 500);
}

function stopProgressTimer(player) {
  const state = getPlayerState(player);
  if (!state.progressTimer) return;

  window.clearInterval(state.progressTimer);
  state.progressTimer = null;
  updateProgressFromYouTube(player);
}

function handleYouTubeStateChange(player, event) {
  const ytState = window.YT?.PlayerState;
  if (!ytState) return;

  if (event.data === ytState.PLAYING) {
    setPlayLabel(player, true);
    startProgressTimer(player);
    return;
  }

  if (event.data === ytState.PAUSED || event.data === ytState.ENDED || event.data === ytState.CUED) {
    if (event.data === ytState.ENDED) {
      const state = getPlayerState(player);
      updateProgress(player, state.duration, state.duration);
    }
    setPlayLabel(player, false);
    stopProgressTimer(player);
  }
}

function ensureYouTubePlayer(player) {
  const state = getPlayerState(player);
  const videoId = player?.getAttribute('data-video-id');
  const frame = player?.querySelector('[data-youtube-frame]');
  const frameShell = player?.querySelector('[data-youtube-frame-shell]');
  if (!player || !videoId || !frame || !frameShell) return Promise.reject(new Error('Missing YouTube player markup.'));

  frameShell.hidden = false;
  if (!frame.id) {
    playerId += 1;
    frame.id = `mana-youtube-footer-${playerId}`;
  }

  if (!frame.getAttribute('src') || !frame.getAttribute('src').includes(`/embed/${videoId}`)) {
    frame.setAttribute('src', buildEmbedUrl(videoId));
  }

  if (state.readyPromise) return state.readyPromise;

  state.readyPromise = loadYouTubeApi().then((YT) => new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (state.ytPlayer) {
        resolve(state.ytPlayer);
      } else {
        reject(new Error('YouTube player did not become ready.'));
      }
    }, 9000);

    state.ytPlayer = new YT.Player(frame.id, {
      events: {
        onAutoplayBlocked: () => {
          state.pendingPlay = false;
          setPlayLabel(player, false);
          stopProgressTimer(player);
        },
        onReady: (readyEvent) => {
          window.clearTimeout(timeout);
          state.ytPlayer = readyEvent.target;
          state.videoId = videoId;
          updateProgressFromYouTube(player);
          resolve(readyEvent.target);
          if (state.pendingPlay) readyEvent.target.playVideo();
        },
        onStateChange: (stateEvent) => handleYouTubeStateChange(player, stateEvent),
      },
    });
  })).catch((error) => {
    state.readyPromise = null;
    throw error;
  });

  return state.readyPromise;
}

async function playVideo(player) {
  const videoId = player?.getAttribute('data-video-id');
  const frame = player?.querySelector('[data-youtube-frame]');
  const frameShell = player?.querySelector('[data-youtube-frame-shell]');
  if (!player || !videoId || !frame || !frameShell) return;

  frameShell.hidden = false;
  const state = getPlayerState(player);
  state.pendingPlay = true;
  setPlayLabel(player, true);

  try {
    const ytPlayer = await ensureYouTubePlayer(player);
    if (state.videoId !== videoId) {
      state.videoId = videoId;
      updateProgress(player, 0, 0);
      ytPlayer.loadVideoById(videoId);
    } else {
      ytPlayer.playVideo();
    }
  } catch {
    frame.setAttribute('src', buildEmbedUrl(videoId, true));
  } finally {
    state.pendingPlay = false;
  }
}

function pauseVideo(player) {
  const frame = player?.querySelector('[data-youtube-frame]');
  const frameShell = player?.querySelector('[data-youtube-frame-shell]');
  if (!player) return;

  const state = getPlayerState(player);
  state.pendingPlay = false;

  try {
    if (typeof state.ytPlayer?.pauseVideo === 'function') {
      state.ytPlayer.pauseVideo();
    } else {
      frame?.removeAttribute('src');
      if (frameShell) frameShell.hidden = true;
    }
  } catch {
    frame?.removeAttribute('src');
    if (frameShell) frameShell.hidden = true;
  }

  stopProgressTimer(player);
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
  player.querySelectorAll('[data-youtube-option][data-current="true"]').forEach((currentOption) => {
    currentOption.removeAttribute('data-current');
  });
  option.setAttribute('data-current', 'true');
  updateProgress(player, 0, 0);

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

function getSeekSecondsFromPointer(player, pointerEvent) {
  const state = getPlayerState(player);
  const track = player.querySelector('[data-youtube-progress]');
  const rect = track?.getBoundingClientRect();
  if (!rect?.width || !state.duration) return null;

  const ratio = clamp((pointerEvent.clientX - rect.left) / rect.width, 0, 1);
  return ratio * state.duration;
}

function commitSeek(player, seconds) {
  const state = getPlayerState(player);
  if (!Number.isFinite(seconds) || !state.duration) return;

  updateProgress(player, seconds, state.duration);
  try {
    state.ytPlayer?.seekTo?.(seconds, true);
  } catch {
    // If the YouTube player is still warming up, keep the visual position only.
  }
}

function handleProgressPointerDown(event) {
  const track = event.target?.closest?.('[data-youtube-progress]');
  const player = getPlayer(track);
  if (!track || !player) return;

  const state = getPlayerState(player);
  const seconds = getSeekSecondsFromPointer(player, event);
  if (seconds === null) return;

  event.preventDefault();
  event.stopPropagation();
  state.isSeeking = true;
  activeSeek = { player, track };
  updateProgress(player, seconds, state.duration);
  track.setPointerCapture?.(event.pointerId);
}

function handleProgressPointerMove(event) {
  if (!activeSeek) return;

  const { player } = activeSeek;
  const state = getPlayerState(player);
  const seconds = getSeekSecondsFromPointer(player, event);
  if (seconds === null) return;

  updateProgress(player, seconds, state.duration);
}

function finishProgressSeek(event) {
  if (!activeSeek) return;

  const { player, track } = activeSeek;
  const state = getPlayerState(player);
  const seconds = getSeekSecondsFromPointer(player, event);
  if (seconds !== null) commitSeek(player, seconds);
  state.isSeeking = false;
  activeSeek = null;
  track.releasePointerCapture?.(event.pointerId);
}

function handleProgressKeydown(event) {
  const track = event.target?.closest?.('[data-youtube-progress]');
  const player = getPlayer(track);
  if (!track || !player) return false;

  const state = getPlayerState(player);
  if (!state.duration) return false;

  let nextTime = state.currentTime;
  if (event.key === 'ArrowLeft') nextTime -= SEEK_STEP_SECONDS;
  if (event.key === 'ArrowRight') nextTime += SEEK_STEP_SECONDS;
  if (event.key === 'Home') nextTime = 0;
  if (event.key === 'End') nextTime = state.duration;
  if (nextTime === state.currentTime) return false;

  event.preventDefault();
  event.stopPropagation();
  commitSeek(player, clamp(nextTime, 0, state.duration));
  return true;
}

function handleDocumentClick(event) {
  const target = event.target;
  const option = target?.closest?.('[data-youtube-option]');
  const playToggle = target?.closest?.('[data-youtube-toggle]');
  const playlistToggle = target?.closest?.('[data-youtube-playlist-toggle]');
  const progressTrack = target?.closest?.('[data-youtube-progress]');

  if (progressTrack) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

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

    if (frameShell && !isPlaying && !getPlayerState(player).ytPlayer) frameShell.hidden = true;
    setPlayLabel(player, isPlaying);
    updateProgressFromYouTube(player);
    closePlaylist(player);
  });
}

document.documentElement.dataset.manaFooterPlayerScript = 'youtube-api';

if (!window.__manaYoutubeFooterDelegated) {
  window.__manaYoutubeFooterDelegated = true;
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('pointerdown', handleProgressPointerDown);
  document.addEventListener('pointermove', handleProgressPointerMove);
  document.addEventListener('pointerup', finishProgressSeek);
  document.addEventListener('pointercancel', finishProgressSeek);
  document.addEventListener('keydown', (event) => {
    if (handleProgressKeydown(event)) return;
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
