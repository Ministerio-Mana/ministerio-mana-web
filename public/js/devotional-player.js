(() => {
  const PLAYER_SELECTOR = '[data-devotional-player]';
  const FRAME_SELECTOR = '[data-devotional-frame]';
  const TRACK_SELECTOR = '[data-devotional-video]';
  const STATE = {
    playing: false,
    currentVideoId: '',
    currentIndex: 0,
  };
  const apiPlayers = new WeakMap();

  function loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (window.__manaYouTubeApiPromise) return window.__manaYouTubeApiPromise;

    window.__manaYouTubeApiPromise = new Promise((resolve) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousReady === 'function') previousReady();
        resolve(window.YT);
      };

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.head.appendChild(script);
      }
    });

    return window.__manaYouTubeApiPromise;
  }

  function sendCommand(frame, func, args = []) {
    if (!frame?.contentWindow) return;
    const targetOrigin = new URL(frame.src).origin;
    frame.contentWindow.postMessage(
      JSON.stringify({
        event: 'command',
        func,
        args,
      }),
      targetOrigin,
    );
  }

  function getTracks(player) {
    return Array.from(player.querySelectorAll(TRACK_SELECTOR));
  }

  function getCurrentIndex(player) {
    const tracks = getTracks(player);
    const activeIndex = tracks.findIndex((track) => track.getAttribute('aria-current') === 'true');
    return activeIndex >= 0 ? activeIndex : STATE.currentIndex || 0;
  }

  function setPlaying(player, playing) {
    STATE.playing = playing;
    player.dataset.playing = String(playing);
    const label = player.querySelector('[data-devotional-toggle-label]');
    const toggle = player.querySelector('[data-devotional-toggle]');
    const playLabel = player.getAttribute('data-play-label') || 'Reproducir';
    const pauseLabel = player.getAttribute('data-pause-label') || 'Pausar';
    if (label) label.textContent = playing ? pauseLabel : playLabel;
    if (toggle) toggle.setAttribute('aria-label', playing ? pauseLabel : playLabel);
  }

  function setPlayerReady(player, ready) {
    player.dataset.youtubeReady = String(ready);
  }

  function applyAudioPostMessages(frame, videoId) {
    if (videoId) sendCommand(frame, 'loadVideoById', [videoId]);
    sendCommand(frame, 'unMute');
    sendCommand(frame, 'setVolume', [100]);
    sendCommand(frame, 'playVideo');
  }

  function getApiPlayer(player) {
    const existing = apiPlayers.get(player);
    if (existing) return existing;

    const frame = player.querySelector(FRAME_SELECTOR);
    const promise = loadYouTubeApi().then(
      (YT) =>
        new Promise((resolve) => {
          const apiPlayer = new YT.Player(frame, {
            events: {
              onReady: () => {
                setPlayerReady(player, true);
                resolve(apiPlayer);
              },
              onStateChange: (event) => {
                if (event.data === YT.PlayerState.PLAYING) setPlaying(player, true);
                if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
                  setPlaying(player, false);
                }
              },
              onError: () => {
                setPlaying(player, false);
              },
            },
          });
        }),
    );

    apiPlayers.set(player, promise);
    return promise;
  }

  function updateCurrentTrack(player, control) {
    const tracks = getTracks(player);
    const videoId = control.getAttribute('data-devotional-video') || '';
    const title = control.getAttribute('data-devotional-track-title') || '';
    const description = control.getAttribute('data-devotional-track-description') || '';
    const image = control.getAttribute('data-devotional-track-image') || '';
    const url = control.getAttribute('data-devotional-track-url') || '';

    STATE.currentVideoId = videoId;
    STATE.currentIndex = Math.max(0, tracks.indexOf(control));
    const titleNode = player.querySelector('[data-devotional-title]');
    const descriptionNode = player.querySelector('[data-devotional-description]');
    const imageNode = player.querySelector('[data-devotional-image]');
    const linkNode = player.querySelector('[data-devotional-link]');

    if (titleNode && title) titleNode.textContent = title;
    if (descriptionNode && description) descriptionNode.textContent = description;
    if (imageNode && image) imageNode.setAttribute('src', image);
    if (linkNode && url) {
      linkNode.setAttribute('href', url);
      if (title) linkNode.setAttribute('aria-label', title);
    }

    tracks.forEach((item) => item.removeAttribute('aria-current'));
    control.setAttribute('aria-current', 'true');
  }

  function closePlaylist(player) {
    player.querySelectorAll('.mana-playlist[open]').forEach((details) => {
      details.removeAttribute('open');
    });
  }

  function playVideo(player, videoId = STATE.currentVideoId) {
    const frame = player.querySelector(FRAME_SELECTOR);
    applyAudioPostMessages(frame, videoId);
    setPlaying(player, true);

    getApiPlayer(player).then((apiPlayer) => {
      if (videoId && apiPlayer.getVideoData?.()?.video_id !== videoId) {
        apiPlayer.loadVideoById(videoId);
      }
      apiPlayer.unMute?.();
      apiPlayer.setVolume?.(100);
      apiPlayer.playVideo?.();

      window.setTimeout(() => {
        apiPlayer.unMute?.();
        apiPlayer.setVolume?.(100);
        apiPlayer.playVideo?.();
      }, 250);
    });
  }

  function pauseVideo(player) {
    const frame = player.querySelector(FRAME_SELECTOR);
    sendCommand(frame, 'pauseVideo');
    setPlaying(player, false);
    getApiPlayer(player).then((apiPlayer) => apiPlayer.pauseVideo?.());
  }

  function loadTrack(player, control, autoplay = true) {
    const videoId = control.getAttribute('data-devotional-video');
    if (!videoId) return;
    updateCurrentTrack(player, control);
    if (autoplay) playVideo(player, videoId);
  }

  function stepTrack(player, direction) {
    const tracks = getTracks(player);
    if (!tracks.length) return;
    const currentIndex = getCurrentIndex(player);
    const nextIndex = (currentIndex + direction + tracks.length) % tracks.length;
    loadTrack(player, tracks[nextIndex], true);
  }

  function bindPlayer(player) {
    if (!player || player.dataset.devotionalBound === 'true') return;
    player.dataset.devotionalBound = 'true';
    const frame = player.querySelector(FRAME_SELECTOR);
    const firstTrack = getTracks(player)[0];
    STATE.currentVideoId =
      firstTrack?.getAttribute('data-devotional-video') ||
      frame?.getAttribute('data-devotional-initial-video') ||
      STATE.currentVideoId;

    frame?.addEventListener('load', () => {
      if (STATE.playing) applyAudioPostMessages(frame, STATE.currentVideoId);
    });

    getApiPlayer(player);

    player.querySelector('[data-devotional-toggle]')?.addEventListener('click', () => {
      if (STATE.playing) {
        pauseVideo(player);
      } else {
        playVideo(player);
      }
    });

    player.querySelectorAll('[data-devotional-step]').forEach((control) => {
      control.addEventListener('click', () => {
        const direction = Number(control.getAttribute('data-devotional-step'));
        if (!direction) return;
        stepTrack(player, direction);
      });
    });

    getTracks(player).forEach((control) => {
      control.addEventListener('click', () => {
        loadTrack(player, control, true);
        closePlaylist(player);
      });
    });

    setPlaying(player, STATE.playing);
  }

  function closeFloatingPlaylists(event) {
    document.querySelectorAll('.mana-playlist[open]').forEach((details) => {
      if (!details.contains(event.target)) details.removeAttribute('open');
    });
  }

  function closeFloatingPlaylistsOnEscape(event) {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.mana-playlist[open]').forEach((details) => {
      details.removeAttribute('open');
    });
  }

  function initDevotionalPlayers() {
    document.querySelectorAll(PLAYER_SELECTOR).forEach(bindPlayer);
  }

  if (!window.__manaDevotionalGlobalEvents) {
    window.__manaDevotionalGlobalEvents = true;
    document.addEventListener('click', closeFloatingPlaylists);
    document.addEventListener('keydown', closeFloatingPlaylistsOnEscape);
  }

  document.addEventListener('DOMContentLoaded', initDevotionalPlayers);
  document.addEventListener('astro:page-load', initDevotionalPlayers);
  initDevotionalPlayers();
})();
