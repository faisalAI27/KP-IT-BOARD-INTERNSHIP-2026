export function initNavigation() {
  const menuToggle = document.querySelector(".menu-toggle");
  const primaryNavigation = document.getElementById("primary-navigation");

  if (!menuToggle || !primaryNavigation) return;

  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  for (const link of primaryNavigation.querySelectorAll("a[data-public-nav]")) {
    const targetPage = link.getAttribute("href")?.split(/[?#]/, 1)[0];
    if (targetPage === currentPage) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

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

  primaryNavigation.querySelectorAll("a, button[data-nav-target]").forEach((link) => {
    link.addEventListener("click", closeNavigation);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNavigation();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeNavigation();
  });
}
