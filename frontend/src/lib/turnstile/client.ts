/*
This module controls Cloudflare Turnstile on the client side.
It does these jobs:
1. Load the Cloudflare script.
2. Render the hidden widget.
3. Start the challenge when the application asks for a token.
4. Return one token.
5. Reset the widget after a submit.
6. Follow the site theme.
7. Report setup failures and attempt failures.
8. Cancel old attempts after a reset.
 */

export const CREATE_ACTION = "create-paste";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js"; // module adds ?render=explicit&onload=__turnstileReady
const ONLOAD_CALLBACK = "__turnstileReady";
const LOAD_TIMEOUT_MS = 10_000;
const CHALLENGE_TIMEOUT_MS = 120_000;

export class TurnstileError extends Error {
  override readonly name = "TurnstileError";
}

type TurnstileApi = {
  render(container: string | HTMLElement, options: Record<string, unknown>): string;
  execute(container: string | HTMLElement): void;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// This function checks whether a value is the Cloudflare API.
const isApi = (value: unknown): value is TurnstileApi =>
  typeof (value as TurnstileApi | undefined)?.render === "function";

const currentTheme = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

let loading: Promise<TurnstileApi> | undefined;

// loadApi loads the Cloudflare script.
/*
1. If window.turnstile is already the API, return a resolved promise.
2. If loading already exists, return it.
3. Create a new promise.
4. Store the promise in loading.
5. Start the 10-second timer.
6. Set window.__turnstileReady.
7. Create a <script> element.
8. Set the script source.
9. Set async to true.
10. Set the error handler.
11. Append the script to <head>.
12. Return the promise.
*/
function loadApi(): Promise<TurnstileApi> {
  if (isApi(window.turnstile)) return Promise.resolve(window.turnstile);

  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const giveUp = (why: string) => {
      clearTimeout(timer);
      loading = undefined; // allow a retry on the next call
      reject(new Error(why));
    };
    const timer = setTimeout(() => giveUp("timed out"), LOAD_TIMEOUT_MS);

    // Cloudflare calls this function after the script loads.
    (window as unknown as Record<string, unknown>)[ONLOAD_CALLBACK] = () => {
      clearTimeout(timer);
      if (isApi(window.turnstile)) resolve(window.turnstile);
      else giveUp("api.js loaded without window.turnstile");
    };

    const script = document.createElement("script");
    script.src = `${SCRIPT_URL}?render=explicit&onload=${ONLOAD_CALLBACK}`;
    script.async = true;
    /*
    This runs when the browser cannot load the script.
    Examples:
    - An ad blocker blocks the script.
    - The browser is offline.
    - The network rejects the request.
    - A content security policy blocks the script.
    */
    script.onerror = () => giveUp("script blocked or offline");
    document.head.append(script);
  });

  return loading;
}

export type TurnstileOptions = {
  container: string | HTMLElement;
  action: string;
  siteKey?: string;
  onError?: (message: string) => void;
};

export type TurnstileHandle = {
  getToken(): Promise<string>;
  error(): string;
  reset(): void;
};

type Pending = {
  resolve(token: string): void;
  reject(error: Error): void;
};

/*
This function creates one controller.
Each controller has its own state.
The module does not start work at import time.
Work starts when a caller calls createTurnstile.
*/
export function createTurnstile(options: TurnstileOptions): TurnstileHandle {
  const { container, action, onError } = options;
  const siteKey = options.siteKey ?? import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;

  let api: TurnstileApi | undefined;
  let token = "";
  let failure = "";
  let widgetId: string | undefined;
  let renderedTheme = "";
  let pending: Pending | undefined;
  let inflight: { epoch: number; promise: Promise<string> } | undefined;
  let epoch = 0;

  // This function removes the pending callbacks before it rejects.
  const rejectPending = (error: Error) => {
    const p = pending;
    pending = undefined;
    p?.reject(error);
  };

  // fail handles a permanent failure.
  const fail = (message: string, detail?: unknown) => {
    token = "";
    failure = message;
    console.error("[turnstile]", message, detail ?? "");
    onError?.(message);
    rejectPending(new TurnstileError(message));
  };

  // failAttempt handles an attempt failure.
  const failAttempt = (message: string) => {
    rejectPending(new TurnstileError(message));
    if (api && widgetId !== undefined) api.reset(widgetId);
  };

  // mount renders the widget.
  const mount = () => {
    if (!api) return;
    if (typeof container === "string" && !document.querySelector(container)) {
      return fail(`Turnstile container "${container}" was not found on the page.`);
    }
    try {
      renderedTheme = currentTheme();
      widgetId = api.render(container, {
        sitekey: siteKey,
        action,
        theme: renderedTheme,
        size: "flexible",
        execution: "execute",
        appearance: "execute",
        callback: (value: string) => {
          token = value;
          failure = "";
          const p = pending;
          pending = undefined;
          p?.resolve(value);
        },
        "expired-callback": () => {
          token = "";
        },
        "error-callback": (code?: string) => {
          const message = `Verification error${code ? ` ${code}` : ""}.`;
          if (pending) failAttempt(`${message} Try again.`);
          else fail(`${message} Reload the page.`);
        },
        "timeout-callback": () => failAttempt("Verification timed out. Try again."),
        "unsupported-callback": () => fail("This browser is not supported by the verification check."),
      });
    } catch (error) {
      fail(`Verification widget failed to start: ${reason(error)}`, error);
    }
  };

  // remount rebuilds the widget when the theme changes.
  const remount = () => {
    if (api && widgetId !== undefined) api.remove(widgetId);
    widgetId = undefined;
    token = "";
    mount();
  };

  let ready: Promise<void>;
  if (!siteKey) {
    fail("Turnstile site key is missing. Set PUBLIC_TURNSTILE_SITE_KEY and restart the dev server.");
    ready = Promise.resolve();
  } else {
    ready = loadApi().then(
      (loaded) => {
        api = loaded;
        mount();
      },
      (error) =>
        fail("Verification failed to load. Disable your ad blocker for this site and reload.", error),
    );

    // The observer watches the class attribute on <html>. and remounts the widget.
    new MutationObserver(() => {
      if (widgetId !== undefined && !pending && !token && renderedTheme !== currentTheme()) remount();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }

  const acquire = async (): Promise<string> => {
    const startedAt = epoch;
    await ready; // a click while api.js is still loading just waits for it
    if (startedAt !== epoch) throw new TurnstileError("Verification was cancelled.");
    if (failure) throw new TurnstileError(failure);
    if (!api || widgetId === undefined) {
      throw new TurnstileError("Verification is unavailable. Reload the page.");
    }
    if (token) return token;

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => failAttempt("Verification timed out. Try again."),
        CHALLENGE_TIMEOUT_MS,
      );
      pending = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      try {
        api!.execute(container);
      } catch (error) {
        rejectPending(new TurnstileError(`Verification could not start: ${reason(error)}`));
      }
    });
  };

  return {
    getToken() {
      // Share one attempt between double calls, but never reuse one from before a reset().
      if (inflight?.epoch === epoch) return inflight.promise;
      const attempt: NonNullable<typeof inflight> = {
        epoch,
        promise: acquire().finally(() => {
          if (inflight === attempt) inflight = undefined;
        }),
      };
      inflight = attempt;
      return attempt.promise;
    },
    error: () => failure,
    reset() {
      epoch++;
      rejectPending(new TurnstileError("Verification was cancelled."));
      token = "";
      if (!api || widgetId === undefined) return;
      if (renderedTheme !== currentTheme()) remount();
      else api.reset(widgetId);
    },
  };
}