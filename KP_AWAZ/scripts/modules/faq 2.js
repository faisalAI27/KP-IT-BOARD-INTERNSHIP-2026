export function initFaq() {
  const faqButtons = document.querySelectorAll(".faq-q");

  faqButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      const answer = document.getElementById(button.getAttribute("aria-controls"));

      button.setAttribute("aria-expanded", String(!isOpen));
      answer.style.maxHeight = isOpen ? "0px" : `${answer.scrollHeight}px`;
    });
  });

  window.addEventListener("resize", () => {
    document.querySelectorAll('.faq-q[aria-expanded="true"]').forEach((button) => {
      const answer = document.getElementById(button.getAttribute("aria-controls"));
      answer.style.maxHeight = `${answer.scrollHeight}px`;
    });
  });
}

