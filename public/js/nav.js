// Bottom tab bar, the single source of truth for site navigation.
//
// Every page used to carry its own hand-copied 9-link <nav>, so adding
// a page meant editing 10 files. Now each page loads this one file with
//   <script type="module" src="js/nav.js"></script>
// and this script builds the bar and adds it to the page. To change the
// navigation, edit the TABS list below and nothing else.
//
// What it builds:
//   - Six tabs: Home, Scoreboard, Rounds, Roster, Stats, More.
//   - "Rounds" and "More" are buttons that open a small popover menu of
//     links (Round 1-4, and Schedule) instead of going to a page.
//   - The tab for the current page is highlighted.
//   - A popover closes when you tap anywhere else or press Escape.
//
// It only touches its own elements (all class names start with "tab"),
// so it can't interfere with the page scripts (round.js, index.js, ...).

// ------------------------------------------------------------------
// Icons: small inline SVG line drawings on a 24x24 grid. "Inline" means
// the drawing instructions are right here in the HTML, so nothing extra
// is downloaded and no icon library is needed. The stroke color comes
// from CSS (currentColor), so an icon is dim or white along with its
// tab's label.
// ------------------------------------------------------------------
const ICONS = {
  // A house outline.
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  // A scoreboard: a panel split in two, with a score bar on each side.
  scoreboard: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><path d="M7 10v4M17 10v4"/>',
  // A flag on a pin, standing in a hole.
  rounds: '<path d="M7 21V3.5"/><path d="M7 4h10l-2.5 3.5L17 11H7"/><ellipse cx="7" cy="21" rx="4" ry="1"/>',
  // Two people.
  roster: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.2c2.6.2 4.5 2.4 4.5 5.8"/>',
  // A bar chart.
  stats: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V6M17 20v-9"/>',
  // Three dots ("more").
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
};

// ------------------------------------------------------------------
// The tabs, in display order.
//   - A tab with `href` is a plain link.
//   - A tab with `menu` is a button that opens a popover of links.
//   - `pages` lists every page file that counts as "this tab" for the
//     highlighting, e.g. player.html counts as Roster.
// ------------------------------------------------------------------
const TABS = [
  { id: "home", label: "Home", href: "index.html", pages: ["index.html"] },
  { id: "scoreboard", label: "Scoreboard", href: "scoreboard.html", pages: ["scoreboard.html"] },
  {
    id: "rounds",
    label: "Rounds",
    menu: [
      { label: "Round 1", href: "round1.html" },
      { label: "Round 2", href: "round2.html" },
      { label: "Round 3", href: "round3.html" },
      { label: "Round 4", href: "round4.html" },
    ],
  },
  { id: "roster", label: "Roster", href: "roster.html", pages: ["roster.html", "player.html"] },
  { id: "stats", label: "Stats", href: "stats.html", pages: ["stats.html"] },
  {
    id: "more",
    label: "More",
    menu: [
      { label: "Schedule", href: "schedule.html" },
      // Organizer tools (players, teams, pairings, strokes). Anyone can
      // open it, but nothing shows until the admin code is entered.
      { label: "Admin", href: "admin.html" },
    ],
  },
];

// ------------------------------------------------------------------
// Which page are we on? location.pathname is the part of the URL after
// the domain, e.g. "/round2.html", or just "/" for the home page. We
// keep only the last piece and treat "" as index.html. The ".html" is
// added if it's missing, in case the host ever serves "clean" URLs
// like "/round2".
// ------------------------------------------------------------------
function currentPageFile() {
  let file = location.pathname.split("/").pop();
  if (file === "") file = "index.html";
  if (!file.endsWith(".html")) file += ".html";
  return file;
}

// A tab is active if the current page is one of its pages, or (for a
// popover tab) one of its menu links.
function isTabActive(tab, page) {
  if (tab.pages) return tab.pages.includes(page);
  return tab.menu.some((item) => item.href === page);
}

function svgIcon(id) {
  // aria-hidden: screen readers skip the drawing and read the label.
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>`;
}

// ------------------------------------------------------------------
// Build the HTML as one template string, then insert it once.
// aria-current / aria-expanded / aria-controls are standard
// accessibility attributes that tell screen readers "this is the
// current page" and "this button opens that menu, which is open/closed".
// ------------------------------------------------------------------
function buildNavHtml(page) {
  let tabsHtml = "";
  let popoversHtml = "";

  for (const tab of TABS) {
    const active = isTabActive(tab, page);
    const activeClass = active ? " is-active" : "";
    const inner = `${svgIcon(tab.id)}<span class="tab-label">${tab.label}</span>`;

    if (tab.href) {
      tabsHtml += `<a class="tab${activeClass}" href="${tab.href}"${active ? ' aria-current="page"' : ""}>${inner}</a>`;
    } else {
      const popoverId = `tab-popover-${tab.id}`;
      tabsHtml += `<button type="button" class="tab${activeClass}" data-popover="${popoverId}"
                     aria-expanded="false" aria-controls="${popoverId}">${inner}</button>`;

      const links = tab.menu
        .map((item) => {
          const here = item.href === page;
          return `<a href="${item.href}"${here ? ' class="is-active" aria-current="page"' : ""}>${item.label}</a>`;
        })
        .join("");
      popoversHtml += `<div class="tab-popover" id="${popoverId}" hidden>${links}</div>`;
    }
  }

  return `<nav class="tabbar" aria-label="Main">
            <div class="tabbar-row">${tabsHtml}</div>
            ${popoversHtml}
          </nav>`;
}

// ------------------------------------------------------------------
// Popover open/close. At most one popover is open at a time; `openButton`
// remembers which tab button opened the current one (null if none).
// ------------------------------------------------------------------
let openButton = null;

function popoverFor(button) {
  return document.getElementById(button.dataset.popover);
}

// Place the popover above its tab, centered on it, but kept at least
// 8px from either screen edge (so "More", the rightmost tab, doesn't
// push its menu off the right side). The height is handled in CSS.
function positionPopover(button, popover) {
  const margin = 8;
  const tabBox = button.getBoundingClientRect();
  const width = popover.offsetWidth;
  const centered = tabBox.left + tabBox.width / 2 - width / 2;
  // Clamp: the smallest allowed left edge is `margin`; the largest keeps
  // the right edge `margin` from the screen's right side.
  const maxLeft = document.documentElement.clientWidth - width - margin;
  const left = Math.max(margin, Math.min(centered, maxLeft));
  popover.style.left = `${left}px`;
}

function closePopover({ returnFocus = false } = {}) {
  if (!openButton) return;
  popoverFor(openButton).hidden = true;
  openButton.setAttribute("aria-expanded", "false");
  if (returnFocus) openButton.focus();   // after Escape, keep keyboard focus on the tab
  openButton = null;
}

function openPopover(button) {
  closePopover();
  const popover = popoverFor(button);
  popover.hidden = false;   // must be visible before we can measure its width
  positionPopover(button, popover);
  button.setAttribute("aria-expanded", "true");
  openButton = button;
}

// ------------------------------------------------------------------
// Wire it up.
// ------------------------------------------------------------------
function initNav() {
  document.body.insertAdjacentHTML("beforeend", buildNavHtml(currentPageFile()));

  // Tapping a Rounds/More tab toggles its popover.
  document.querySelectorAll(".tabbar button.tab[data-popover]").forEach((button) => {
    button.addEventListener("click", () => {
      if (openButton === button) closePopover();
      else openPopover(button);
    });
  });

  // Tap anywhere outside the open popover and its button: close it.
  // One listener on the whole document checks where the tap landed.
  // (Taps on the button itself are left to the toggle handler above.)
  document.addEventListener("click", (event) => {
    if (!openButton) return;
    const popover = popoverFor(openButton);
    if (popover.contains(event.target) || openButton.contains(event.target)) return;
    closePopover();
  });

  // Escape key closes it.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopover({ returnFocus: true });
  });

  // Rotating the phone or resizing the window moves the tabs, so close
  // any open popover rather than leave it floating in the wrong place.
  // Only a WIDTH change counts: iPhone Safari also fires "resize" when
  // its address bar shrinks during scrolling, which changes only the
  // height and shouldn't close anything.
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    closePopover();
  });
}

// Module scripts run after the HTML is parsed, so <body> exists here.
initNav();
