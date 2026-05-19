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
  const readyApiPlayers = new WeakMap();

  function loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (window.__manaYouTubeApiPromise) return window.__manaYouTubeApiPromise;

    window.__manaYouTubeApiPromise = new Promise((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      const staleScripts = document.querySelectorAll('script[data-mana-youtube-api], script[src="https://www.youtube.com/iframe_api"]');
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        window.__manaYouTubeApiPromise = null;
        reject(new Error('YouTube iframe API timed out'));
      }, 6000);

      window.onYouTubeIframeAPIReady = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (typeof previousReady === 'function') previousReady();
        resolve(window.YT);
      };

      staleScripts.forEach((script) => script.remove());

      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.manaYoutubeApi = 'true';
      script.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.__manaYouTubeApiPromise = null;
        reject(new Error('YouTube iframe API failed to load'));
      };
      document.head.appendChild(script);
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

  function retryAudioPostMessages(frame, videoId) {
    applyAudioPostMessages(frame, videoId);
    [250, 750, 1500].forEach((delay) => {
      window.setTimeout(() => applyAudioPostMessages(frame, videoId), delay);
    });
  }

  function getApiPlayer(player) {
    const existing = apiPlayers.get(player);
    if (existing) return existing;

    const frame = player.querySelector(FRAME_SELECTOR);
    const promise = loadYouTubeApi()
      .then(
        (YT) =>
          new Promise((resolve) => {
          const apiPlayer = new YT.Player(frame, {
            events: {
              onReady: () => {
                readyApiPlayers.set(player, apiPlayer);
                setPlayerReady(player, true);
                resolve(apiPlayer);
              },
              onStateChange: (event) => {
                player.dataset.youtubeState = String(event.data);
                if (event.data === YT.PlayerState.PLAYING) setPlaying(player, true);
                if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
                  setPlaying(player, false);
                }
              },
              onError: (event) => {
                player.dataset.youtubeError = String(event.data);
                setPlaying(player, false);
              },
            },
          });
        }),
      )
      .catch(() => {
        setPlayerReady(player, false);
        return null;
      });

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
    setPlaying(player, true);

    const readyApiPlayer = readyApiPlayers.get(player);
    if (readyApiPlayer) {
      const activeVideoId = readyApiPlayer.getVideoData?.()?.video_id || '';
      readyApiPlayer.unMute?.();
      readyApiPlayer.setVolume?.(100);
      if (videoId && activeVideoId !== videoId) {
        readyApiPlayer.loadVideoById(videoId);
      } else {
        readyApiPlayer.playVideo?.();
      }
      window.setTimeout(() => {
        readyApiPlayer.unMute?.();
        readyApiPlayer.setVolume?.(100);
        readyApiPlayer.playVideo?.();
      }, 250);
      return;
    }

    retryAudioPostMessages(frame, videoId);
    getApiPlayer(player).then((apiPlayer) => {
      if (!apiPlayer) return;
      apiPlayer.unMute?.();
      apiPlayer.setVolume?.(100);
      if (videoId && apiPlayer.getVideoData?.()?.video_id !== videoId) {
        apiPlayer.loadVideoById(videoId);
      } else {
        apiPlayer.playVideo?.();
      }

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
    getApiPlayer(player).then((apiPlayer) => apiPlayer?.pauseVideo?.());
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
      if (STATE.playing) retryAudioPostMessages(frame, STATE.currentVideoId);
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
