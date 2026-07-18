"""Small in-memory abuse guard for the public account-status endpoint."""

from collections import deque
from threading import Lock
from time import monotonic

from app.config import settings
from app.services.supabase_auth import AccountStatusRateLimitError


class AccountStatusRateLimiter:
    """Apply a fixed-size sliding window to each direct client address."""

    def __init__(
        self,
        *,
        limit: int | None = None,
        window_seconds: int | None = None,
        clock=monotonic,
    ) -> None:
        self._limit = settings.account_status_rate_limit if limit is None else limit
        self._window_seconds = (
            settings.account_status_rate_window_seconds
            if window_seconds is None
            else window_seconds
        )
        if self._limit <= 0 or self._window_seconds <= 0:
            raise ValueError("rate limit and window_seconds must be positive")
        self._clock = clock
        self._requests: dict[str, deque[float]] = {}
        self._lock = Lock()

    def check(self, client_key: str) -> None:
        """Record one allowed request or raise the safe rate-limit error."""

        safe_key = client_key.strip() if isinstance(client_key, str) else ""
        if not safe_key:
            safe_key = "unknown-client"
        now = float(self._clock())
        cutoff = now - self._window_seconds

        with self._lock:
            attempts = self._requests.setdefault(safe_key, deque())
            while attempts and attempts[0] <= cutoff:
                attempts.popleft()
            if len(attempts) >= self._limit:
                raise AccountStatusRateLimitError()
            attempts.append(now)

            if len(self._requests) > 1024:
                stale_keys = [
                    key
                    for key, values in self._requests.items()
                    if not values or values[-1] <= cutoff
                ]
                for key in stale_keys:
                    self._requests.pop(key, None)


account_status_rate_limiter = AccountStatusRateLimiter()
