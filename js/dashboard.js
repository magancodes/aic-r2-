const ROUTES = [
  {
    id: "home",
    num: "00",
    label: "Overview",
    hint: "The full story",
    title: "Story dashboard",
    crumb: "DigitalTwin.ai",
    src: null,
  },
  {
    id: "opening",
    num: "01",
    label: "Opening",
    hint: "Nothing looked wrong",
    title: "Opening card",
    crumb: "Time · body · station",
    src: "pages/opening.html",
  },
  {
    id: "camera",
    num: "02",
    label: "Sensing",
    hint: "What the camera takes in",
    title: "What the camera actually sees",
    crumb: "Events, not video",
    src: "pages/camera.html",
  },
  {
    id: "live-twin",
    num: "03",
    label: "Live twin",
    hint: "The line, mirrored",
    title: "The line, mirrored",
    crumb: "Floor now · twin +20s",
    src: "pages/live-twin.html",
  },
  {
    id: "architecture",
    num: "04",
    label: "Architecture",
    hint: "Four moves, one mirror",
    title: "Four moves, one mirror",
    crumb: "Sense · mirror · predict · ask",
    src: "pages/architecture.html",
  },
  {
    id: "setup",
    num: "05",
    label: "Setup",
    hint: "Bare line to living twin",
    title: "From bare line to living twin",
    crumb: "Day 1 through ongoing",
    src: "pages/setup.html",
  },
];

const navEl = document.getElementById("nav");
const frame = document.getElementById("frame");
const overview = document.getElementById("overview");
const crumb = document.getElementById("crumb");
const heading = document.getElementById("heading");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const menuBtn = document.getElementById("menu");
const scrim = document.getElementById("scrim");

function setNavOpen(open) {
  document.body.classList.toggle("nav-open", open);
  menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  menuBtn.setAttribute("aria-label", open ? "Close chapters" : "Open chapters");
  scrim.hidden = !open;
}

menuBtn.addEventListener("click", () => setNavOpen(!document.body.classList.contains("nav-open")));
scrim.addEventListener("click", () => setNavOpen(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setNavOpen(false);
});

function routeFromHash() {
  const id = (location.hash.replace("#", "") || "home").toLowerCase();
  return ROUTES.find((r) => r.id === id) || ROUTES[0];
}

function go(id, push) {
  const route = ROUTES.find((r) => r.id === id) || ROUTES[0];
  if (push !== false) {
    const next = route.id === "home" ? "#home" : "#" + route.id;
    if (location.hash !== next) history.pushState({ id: route.id }, "", next);
  }
  render(route);
}

function render(route) {
  setNavOpen(false);
  const idx = ROUTES.indexOf(route);
  [...navEl.children].forEach((el) => {
    el.classList.toggle("active", el.dataset.id === route.id);
  });
  crumb.textContent = route.crumb;
  heading.innerHTML = route.id === "home"
    ? 'The line, <em>as a story.</em>'
    : route.title;

  prevBtn.disabled = idx <= 0;
  nextBtn.disabled = idx >= ROUTES.length - 1;
  prevBtn.onclick = () => idx > 0 && go(ROUTES[idx - 1].id);
  nextBtn.onclick = () => idx < ROUTES.length - 1 && go(ROUTES[idx + 1].id);

  if (route.src) {
    overview.style.display = "none";
    frame.classList.add("show");
    if (frame.getAttribute("src") !== route.src) frame.src = route.src;
  } else {
    frame.classList.remove("show");
    frame.removeAttribute("src");
    overview.style.display = "block";
  }
}

ROUTES.forEach((r) => {
  const a = document.createElement("a");
  a.href = "#" + r.id;
  a.dataset.id = r.id;
  a.innerHTML =
    '<span class="num">' + r.num + "</span>" +
    '<span class="lab"><b>' + r.label + "</b><span>" + r.hint + "</span></span>";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    go(r.id);
  });
  navEl.appendChild(a);
});

document.getElementById("start").addEventListener("click", () => go("opening"));
document.querySelectorAll("[data-go]").forEach((el) => {
  el.addEventListener("click", () => go(el.dataset.go));
});

window.addEventListener("hashchange", () => render(routeFromHash()));
document.addEventListener("keydown", (e) => {
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  const idx = ROUTES.indexOf(routeFromHash());
  if (e.key === "ArrowLeft" && idx > 0) go(ROUTES[idx - 1].id);
  if (e.key === "ArrowRight" && idx < ROUTES.length - 1) go(ROUTES[idx + 1].id);
});

render(routeFromHash());
