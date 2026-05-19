(() => {
  const PLAYER_SELECTOR = '[data-spotify-player]';
  const EMBED_SELECTOR = '[data-spotify-embed]';
  const API_SRC = 'https://open.spotify.com/embed/iframe-api/v1';

  function loadSpotifyApi() {
    if (window.__manaSpotifyIframeApi) return Promise.resolve(window.__manaSpotifyIframeApi);
    if (window.__manaSpotifyApiPromise) return window.__manaSpotifyApiPromise;

    window.__manaSpotifyApiPromise = new Promise((resolve, reject) => {
      const previousReady = window.onSpotifyIframeApiReady;
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Spotify iframe API timed out'));
      }, 6000);

      window.onSpotifyIframeApiReady = (IFrameAPI) => {
        if (typeof previousReady === 'function') previousReady(IFrameAPI);
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.__manaSpotifyIframeApi = IFrameAPI;
        resolve(IFrameAPI);
      };

      if (document.querySelector(`script[src="${API_SRC}"]`)) return;

      const script = document.createElement('script');
      script.src = API_SRC;
      script.async = true;
      script.dataset.manaSpotifyApi = 'true';
      script.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error('Spotify iframe API failed to load'));
      };
      document.head.appendChild(script);
    });

    return window.__manaSpotifyApiPromise;
  }

  function setPlaying(player, playing) {
    player.dataset.playing = String(playing);
    const label = player.querySelector('[data-spotify-toggle-label]');
    const toggle = player.querySelector('[data-spotify-toggle]');
    const playLabel = player.getAttribute('data-play-label') || 'Reproducir';
    const pauseLabel = player.getAttribute('data-pause-label') || 'Pausar';
    if (label) label.textContent = playing ? pauseLabel : playLabel;
    if (toggle) toggle.setAttribute('aria-label', playing ? pauseLabel : playLabel);
  }

  function bindPlayer(player) {
    if (!player || player.dataset.spotifyBound === 'true') return;
    player.dataset.spotifyBound = 'true';

    const embedTarget = player.querySelector(EMBED_SELECTOR);
    const spotifyUri = player.getAttribute('data-spotify-uri');
    const toggle = player.querySelector('[data-spotify-toggle]');
    if (!embedTarget || !spotifyUri || !toggle) return;

    const controllerPromise = loadSpotifyApi()
      .then(
        (IFrameAPI) =>
          new Promise((resolve) => {
            IFrameAPI.createController(
              embedTarget,
              {
                uri: spotifyUri,
                width: '100%',
                height: '152',
                theme: 'dark',
              },
              (controller) => resolve(controller),
            );
          }),
      )
      .then((controller) => {
        player.dataset.spotifyReady = 'true';
        controller.addListener?.('playback_update', (event) => {
          const isPaused = event?.data?.isPaused;
          if (typeof isPaused === 'boolean') setPlaying(player, !isPaused);
        });
        return controller;
      })
      .catch(() => {
        player.dataset.spotifyReady = 'false';
        return null;
      });

    toggle.addEventListener('click', () => {
      controllerPromise.then((controller) => {
        if (!controller) return;
        controller.togglePlay?.();
        setPlaying(player, player.dataset.playing !== 'true');
      });
    });

    setPlaying(player, false);
  }

  function initPlayers() {
    document.querySelectorAll(PLAYER_SELECTOR).forEach(bindPlayer);
  }

  document.addEventListener('DOMContentLoaded', initPlayers);
  document.addEventListener('astro:page-load', initPlayers);
  initPlayers();
})();
