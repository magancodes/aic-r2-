(function () {
  if (window.self !== window.top) {
    document.documentElement.classList.add("in-dashboard");
    return;
  }

  // Root-absolute hrefs so the bar links correctly from /pages/*, /ui/, and /.
  const PAGES = [
    { href: "/", id: "home", label: "Overview", key: "/" },
    { href: "/pages/opening.html", id: "opening", label: "Opening", key: "/pages/opening" },
    { href: "/pages/camera.html", id: "camera", label: "Sensing", key: "/pages/camera" },
    { href: "/pages/live-twin.html", id: "live-twin", label: "Live twin", key: "/pages/live-twin" },
    { href: "/pages/architecture.html", id: "architecture", label: "Architecture", key: "/pages/architecture" },
    { href: "/pages/setup.html", id: "setup", label: "Setup", key: "/pages/setup" },
    { href: "/ui/", id: "drive", label: "Drive it", key: "/ui" },
  ];

  // Normalise a path so cleanUrls (/pages/opening) and raw files
  // (/pages/opening.html) and index/trailing-slash forms all compare equal.
  function norm(p) {
    p = (p || "/").replace(/\/index(\.html)?$/, "/").replace(/\.html$/, "");
    if (p.length > 1) p = p.replace(/\/$/, "");
    return p || "/";
  }

  const here = norm(location.pathname);
  let current = PAGES.findIndex((p) => p.key === here);
  if (current < 0) current = 0;
  const isOpening = PAGES[current].id === "opening";

  document.body.classList.add("has-app-nav");
  if (isOpening) document.body.classList.add("nav-overlay");

  const nav = document.createElement("nav");
  nav.className = "app-nav";
  nav.setAttribute("aria-label", "Story navigation");

  const prev = PAGES[Math.max(0, current - 1)];
  const next = PAGES[Math.min(PAGES.length - 1, current + 1)];

  nav.innerHTML =
    '<a class="brand" href="/">DigitalTwin<em>.ai</em> <span>story</span></a>' +
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
