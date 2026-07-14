export async function loadPartials(root = document) {
  const slots = [...root.querySelectorAll("[data-partial]")];

  await Promise.all(
    slots.map(async (slot) => {
      const partialPath = slot.dataset.partial;
      const response = await fetch(partialPath);

      if (!response.ok) {
        throw new Error(`Could not load ${partialPath} (${response.status}).`);
      }

      const template = document.createElement("template");
      template.innerHTML = await response.text();
      slot.replaceWith(template.content.cloneNode(true));
    }),
  );
}

export function restoreHashPosition() {
  if (!window.location.hash) return;

  const target = document.querySelector(window.location.hash);
  if (target) requestAnimationFrame(() => target.scrollIntoView());
}

