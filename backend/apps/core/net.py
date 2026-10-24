from django.conf import settings
from rest_framework.throttling import BaseThrottle, ScopedRateThrottle


def client_ip(request) -> str:
    """Devuelve la IP real del cliente respetando TRUSTED_PROXY_COUNT.

    Solo confía en la cantidad de saltos desde la derecha de X-Forwarded-For
    configurada en TRUSTED_PROXY_COUNT (0 en desarrollo, 1 detrás del proxy de
    Railway). Si la cabecera falta o no tiene suficientes saltos válidos, cae
    en REMOTE_ADDR.
    """
    if request is None or not hasattr(request, 'META'):
        return ''
    remote_addr = (request.META.get('REMOTE_ADDR') or '').strip()
    try:
        trusted_proxies = int(getattr(settings, 'TRUSTED_PROXY_COUNT', 0) or 0)
    except (TypeError, ValueError):
        trusted_proxies = 0
    if trusted_proxies <= 0:
        return remote_addr
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if not xff or not isinstance(xff, str):
        return remote_addr
    hops = [part.strip() for part in xff.split(',')]
    if len(hops) < trusted_proxies or any(not part for part in hops[-trusted_proxies:]):
        return remote_addr
    return hops[-trusted_proxies]


class ClientIPScopedRateThrottle(ScopedRateThrottle):
    def get_ident(self, request):
        return client_ip(request)

    def get_rate(self):
        if self.scope == 'password_reset_confirm' and self.scope not in self.THROTTLE_RATES:
            return self.THROTTLE_RATES.get('password_reset', '5/hour')
        return super().get_rate()


BaseThrottle.get_ident = lambda self, request: client_ip(request)
