const SUPPORTED_LOCALES = new Set(['es', 'en']);
const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const button = target.closest('[data-language-switch]');
  if (!(button instanceof HTMLButtonElement)) return;

  const nextLocale = String(button.dataset.nextLocale || '').toLowerCase();
  if (!SUPPORTED_LOCALES.has(nextLocale)) return;

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');

  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `lang=${nextLocale}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  window.location.reload();
});
