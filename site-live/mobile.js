// Phone layer: a WhatsApp button pinned to the bottom once the visitor scrolls past the top, and
// small "1 / 3" counters under the swipeable card rows. Desktop is untouched (styles in mobile.css).
(() => {
  const root = document.documentElement;
  const whatsapp = "https://wa.me/212649402305?text=DEMO";
  const labels = {
    en: { cta: "Try it on WhatsApp", note: "Free · reply in seconds" },
    fr: { cta: "Essayer sur WhatsApp", note: "Gratuit · réponse en quelques secondes" },
    ar: { cta: "جرّب على واتساب", note: "مجاناً · الرد في ثوانٍ" }
  };

  const bar = document.createElement("div");
  bar.className = "mobile-cta";
  bar.innerHTML = `<a class="mobile-cta-button" href="${whatsapp}" target="_blank" rel="noopener"><span class="mobile-cta-icon" aria-hidden="true"></span><span class="mobile-cta-text"><strong></strong><small></small></span></a>`;
  document.body.append(bar);

  const label = () => {
    const copy = labels[root.lang] || labels.en;
    bar.querySelector("strong").textContent = copy.cta;
    bar.querySelector("small").textContent = copy.note;
  };
  label();
  new MutationObserver(label).observe(root, { attributes: true, attributeFilter: ["lang"] });

  // Shown after the top of the page, hidden again where the contact section already offers WhatsApp.
  const hero = document.querySelector("#top"), contact = document.querySelector("#contact");
  let pastHero = false, atContact = false;
  const update = () => bar.classList.toggle("is-visible", pastHero && !atContact);
  if ("IntersectionObserver" in window) {
    if (hero) new IntersectionObserver(([entry]) => { pastHero = !entry.isIntersecting; update(); }, { threshold: 0.05 }).observe(hero);
    if (contact) new IntersectionObserver(([entry]) => { atContact = entry.isIntersecting; update(); }, { threshold: 0.15 }).observe(contact);
  }

  // Swipeable rows get a counter so visitors know there is more to see.
  document.querySelectorAll(".journey, .deep-grid, .offer-grid").forEach((row) => {
    const cards = [...row.children].filter((child) => child.nodeType === 1);
    if (cards.length < 2) return;
    const dots = document.createElement("div");
    dots.className = "swipe-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.innerHTML = cards.map(() => "<i></i>").join("");
    row.after(dots);
    const mark = () => {
      const width = row.clientWidth || 1;
      const index = Math.round(Math.abs(row.scrollLeft) / (cards[0].offsetWidth || width));
      dots.querySelectorAll("i").forEach((dot, i) => dot.classList.toggle("active", i === Math.min(index, cards.length - 1)));
    };
    row.addEventListener("scroll", () => requestAnimationFrame(mark), { passive: true });
    mark();
  });
})();
