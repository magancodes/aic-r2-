(function () {
  if (window.self !== window.top) {
    document.documentElement.classList.add("in-dashboard");
    return;
  }

  const PAGES = [
    { href: "../index.html", id: "home", label: "Overview" },
    { href: "opening.html", id: "opening", label: "Opening" },
    { href: "camera.html", id: "camera", label: "Sensing" },
    { href: "live-twin.html", id: "live-twin", label: "Live twin" },
    { href: "architecture.html", id: "architecture", label: "Architecture" },
    { href: "setup.html", id: "setup", label: "Setup" },
  ];

  const file = (location.pathname.split("/").pop() || "").toLowerCase();
  const idx = PAGES.findIndex((p) => p.href.split("/").pop() === file);
  const current = idx >= 0 ? idx : 0;
  const isOpening = file === "opening.html";

  document.body.classList.add("has-app-nav");
  if (isOpening) document.body.classList.add("nav-overlay");

  const nav = document.createElement("nav");
  nav.className = "app-nav";
  nav.setAttribute("aria-label", "Story navigation");

  const prev = PAGES[Math.max(0, current - 1)];
  const next = PAGES[Math.min(PAGES.length - 1, current + 1)];

  nav.innerHTML =
    '<a class="brand" href="../index.html">DigitalTwin<em>.ai</em> <span>story</span></a>' +
    '<div class="links">' +
    PAGES.map((p, i) => {
      const active = i === current ? " active" : "";
      return '<a class="' + active.trim() + '" href="' + p.href + '">' + p.label + "</a>";
    }).join("") +
    "</div>" +
    '<div class="pager">' +
    (current > 0 ? '<a href="' + prev.href + '">← <span class="lbl">Back</span></a>' : "") +
    (current < PAGES.length - 1 ? '<a href="' + next.href + '"><span class="lbl">Next</span> →</a>' : "") +
    "</div>";

  document.body.appendChild(nav);

  document.addEventListener("keydown", (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === "ArrowLeft" && current > 0) location.href = prev.href;
    if (e.key === "ArrowRight" && current < PAGES.length - 1) location.href = next.href;
  });
})();
