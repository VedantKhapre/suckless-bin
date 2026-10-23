/*
This module stores paste metadata in memory. It also sends update events to components.
*/
import { fetchPaste } from "./endpoints";
import { getSlug } from "./slug";
import type { PasteMeta } from "./types";

const UPDATE_EVENT = "paste:update";

// The cache value is a Promise. This design lets many components share one network request.
const cache = new Map<string, Promise<PasteMeta>>();

/*
1. It reads the cache for the slug.
2. If a Promise exists, it returns that Promise.
3. If no Promise exists, it calls fetchPaste(slug).
4. It stores the Promise in the cache.
5. It attaches a catch handler. The handler deletes the cache entry when the request fails.
6. It returns the Promise.
*/
export function getPaste(slug: string): Promise<PasteMeta> {
  let pending = cache.get(slug);
  if (!pending) {
    pending = fetchPaste(slug);
    cache.set(slug, pending);
    // Do not cache failures, so a retry actually hits the network.
    pending.catch(() => cache.delete(slug));
  }
  return pending;
}

/*
1. It stores a resolved Promise with the new paste data.
2. It dispatches a paste:update event.
3. The event detail is: { slug, paste }
*/
export function setPaste(slug: string, paste: PasteMeta) {
  cache.set(slug, Promise.resolve(paste));
  window.dispatchEvent(
    new CustomEvent<{ slug: string; paste: PasteMeta }>(UPDATE_EVENT, {
      detail: { slug, paste },
    }),
  );
}

/*
1. It reads the current slug with getSlug().
2. It creates an active flag.
3. It creates an event listener.
4. The listener checks the event slug. It calls onPaste only when the event slug matches.
5. It adds the listener to window.
6. If the slug is empty, it calls onError with new Error("No paste in URL").
7. If the slug is present, it calls getPaste(slug).
8. On success, it calls onPaste if the watcher is still active.
9. On failure, it calls onError if the watcher is still active.
10. It returns an unsubscribe function.
11. The unsubscribe function sets active to false and removes the listener.
*/
export function watchPaste(
  onPaste: (paste: PasteMeta) => void,
  onError?: (error: unknown) => void,
) {
  const slug = getSlug();
  let active = true;

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ slug: string; paste: PasteMeta }>)
      .detail;
    if (active && detail.slug === slug) onPaste(detail.paste);
  };

  window.addEventListener(UPDATE_EVENT, listener);

  if (!slug) {
    onError?.(new Error("No paste in URL"));
  } else {
    getPaste(slug).then(
      (paste) => active && onPaste(paste),
      (error) => active && onError?.(error),
    );
  }

  return () => {
    active = false;
    window.removeEventListener(UPDATE_EVENT, listener);
  };
}
