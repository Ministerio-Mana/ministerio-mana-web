export function resolveBaseUrl(request: Request): string {
  const configured = import.meta.env?.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL;
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const runtimeEnv =
    import.meta.env?.VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  const isProd = runtimeEnv === 'production';
  const requestUrl = new URL(request.url);
  const hostHeader = request.headers.get('host') || requestUrl.host;
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProto || (requestUrl.protocol ? requestUrl.protocol.replace(':', '') : 'https');

  if (isProd) {
    const allowlistRaw = import.meta.env?.PUBLIC_ALLOWED_HOSTS ?? process.env.PUBLIC_ALLOWED_HOSTS;
    if (allowlistRaw) {
      const allowlist = new Set(
        allowlistRaw
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      );
      const forwarded = forwardedHost?.toLowerCase();
      const host = hostHeader.toLowerCase();
      if (forwarded && allowlist.has(forwarded)) {
        return `${protocol}://${forwarded}`;
      }
      if (allowlist.has(host)) {
        return `${protocol}://${host}`;
      }
      throw new Error('Host no permitido');
    }
    return `${protocol}://${hostHeader}`;
  }

  const host = forwardedHost || hostHeader;
  return `${protocol}://${host}`;
}
