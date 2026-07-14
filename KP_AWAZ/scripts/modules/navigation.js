export function initNavigation() {
  const menuToggle = document.querySelector(".menu-toggle");
  const primaryNavigation = document.getElementById("primary-navigation");

  if (!menuToggle || !primaryNavigation) return;

  function closeNavigation() {
    primaryNavigation.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
  }

  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    primaryNavigation.classList.toggle("open", !isOpen);
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
  });

  primaryNavigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeNavigation);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNavigation();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeNavigation();
  });
}

