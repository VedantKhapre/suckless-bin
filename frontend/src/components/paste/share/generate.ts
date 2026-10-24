import { collect, validate, type Collected } from "../../../lib/payload/collect";
import { buildPublicPayload } from "../../../lib/payload/public/build";
import { buildPrivatePayload } from "../../../lib/payload/private/build";
import { createPaste, uploadFile, pasteUrl, describeError } from "@/lib/api";
import { createTurnstile, TurnstileError, CREATE_ACTION } from "@/lib/turnstile/client";

const DONE_MS = 2000;

const button = document.querySelector<HTMLButtonElement>("#generate-btn");
if (!button) throw new Error("#generate-btn not found");
const errorList = document.querySelector<HTMLUListElement>("#generate-errors");
const idleLabel = button.textContent?.trim() || "Create";

const showLink = (url: string | null) =>
  window.dispatchEvent(new CustomEvent("paste:link", { detail: url }));

function showErrors(errors: string[]) {
  errorList?.replaceChildren(
    ...errors.map((message) => {
      const li = document.createElement("li");
      li.textContent = message;
      return li;
    }),
  );
}

const setLabel = (text: string) => {
  button.textContent = text;
};

// async, so a synchronous throw becomes a rejection like any other failure
const buildPayload = async (collected: Collected) =>
  collected.visibility === "public"
    ? buildPublicPayload(collected)
    : buildPrivatePayload(collected);

// Prepares the widget only. The challenge itself runs when Create is clicked.
const turnstile = createTurnstile({
  container: "#turnstile-widget",
  action: CREATE_ACTION,
  onError: (message) => showErrors([message]),
});

let busy = false;
let doneTimer: ReturnType<typeof setTimeout> | undefined;

button.addEventListener("click", async () => {
  if (busy) return; // ignore double clicks

  const collected = collect();
  const errors = validate(collected);
  if (turnstile.error()) errors.push(turnstile.error());

  showErrors(errors);
  showLink(null);
  if (errors.length > 0) return;

  busy = true;
  clearTimeout(doneTimer);
  button.disabled = true;
  setLabel("Verifying...");

  try {
    // The challenge and the payload (encryption, for private pastes) run together.
    const [token, payload] = await Promise.all([
      turnstile.getToken(),
      buildPayload(collected),
    ]);

    setLabel("Creating paste...");
    const { slug } = await createPaste(payload, token);

    const total = collected.files.length;
    if (total > 0) {
      let uploaded = 0;
      setLabel(`Uploading files (0/${total})...`);
      await Promise.all(
        collected.files.map(async (file, i) => {
          await uploadFile(slug, i, await file.arrayBuffer());
          setLabel(`Uploading files (${++uploaded}/${total})...`);
        }),
      );
    }

    showLink(pasteUrl(slug));
    setLabel("Created!");
    doneTimer = setTimeout(() => setLabel(idleLabel), DONE_MS);
  } catch (error) {
    showErrors([
      error instanceof TurnstileError ? error.message : describeError(error),
    ]);
    setLabel(idleLabel);
  } finally {
    turnstile.reset();
    button.disabled = false;
    busy = false;
  }
});
