// Kvorum wireframe nav strip — auto-injects on every page.
// Set <body data-wf="<id>"> to mark the active page.
(function () {
  const PAGES = [
    { id: "home",     href: "Homepage Wireframe.html",                label: "Homepage",         spec: "§6.4" },
    { id: "list",     href: "Proposals List Wireframe.html",          label: "All proposals",    spec: "§6.5" },
    { id: "detail",   href: "Proposal Detail Wireframe.html",         label: "Proposal detail",  spec: "§6.9" },
    { id: "daos",     href: "DAOs Index Wireframe.html",              label: "DAOs index",       spec: "§6.6" },
    { id: "health",   href: "DAO Health Dashboard Wireframe.html",    label: "DAO health",       spec: "§6.7" },
    { id: "actor",    href: "Actor Profile Wireframe.html",           label: "Actor profile",    spec: "§6.10" },
    { id: "forum",    href: "Forum Thread Wireframe.html",            label: "Forum thread",     spec: "§6.11" },
    { id: "search",   href: "Search Results Wireframe.html",          label: "Search",           spec: "§6.8" },
    { id: "apidocs",  href: "API Docs Wireframe.html",                label: "API docs",         spec: "§6.12" },
    { id: "auth",     href: "Auth Pages Wireframe.html",              label: "Sign in / up",     spec: "§6.14" },
    { id: "dev",      href: "Developer Dashboard Wireframe.html",     label: "Developer",        spec: "§6.13" },
    { id: "states",   href: "States Wireframe.html",                  label: "Empty/error/loading", spec: "states" },
    { id: "mobile",   href: "Mobile Breakpoints Wireframe.html",      label: "Mobile",           spec: "responsive" },
  ];

  const active = document.body.dataset.wf || "";
  const nav = document.createElement("div");
  nav.className = "set-links";
  nav.innerHTML = PAGES.map(p =>
    `<a class="${p.id === active ? "active" : ""}" href="${p.href}">${p.label}<small>${p.spec}</small></a>`
  ).join("");

  document.body.insertBefore(nav, document.body.firstChild);
})();
