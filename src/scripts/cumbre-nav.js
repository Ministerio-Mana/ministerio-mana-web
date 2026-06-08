const backLink = document.getElementById('cumbre-back-link');

if (backLink) {
  const fallback = backLink.getAttribute('href') || '/eventos/cumbre-mundial-2026';
  const useHistoryBack = backLink.dataset.useHistoryBack !== 'false';
  const ref = document.referrer;

  try {
    if (useHistoryBack && ref) {
      const refUrl = new URL(ref);
      if (refUrl.origin === window.location.origin) {
        backLink.setAttribute('href', refUrl.pathname + refUrl.search + refUrl.hash);
      }
    }
  } catch {
    // ignore invalid referrer
  }

  backLink.addEventListener('click', (event) => {
    if (useHistoryBack && window.history.length > 1) {
      event.preventDefault();
      window.history.back();
    } else {
      backLink.setAttribute('href', fallback);
    }
  });
}
