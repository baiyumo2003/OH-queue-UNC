(function () {
  const isInstructorPage = window.location.pathname === "/instructor";
  if (!isInstructorPage) {
    return;
  }

  const scrollKey = "ohq:instructor-scroll";
  const detailsKey = "ohq:instructor-details";
  const refreshMs = 10000;
  let formDirty = false;

  function saveScroll(reason) {
    try {
      sessionStorage.setItem(
        scrollKey,
        JSON.stringify({
          x: window.scrollX,
          y: window.scrollY,
          reason,
          savedAt: Date.now()
        })
      );
    } catch {
      // Ignore storage failures; the app still works without scroll restoration.
    }
  }

  function restoreScroll() {
    try {
      const raw = sessionStorage.getItem(scrollKey);
      if (!raw) {
        return;
      }

      const saved = JSON.parse(raw);
      if (!saved || Date.now() - Number(saved.savedAt || 0) > 10 * 60 * 1000) {
        sessionStorage.removeItem(scrollKey);
        return;
      }

      window.requestAnimationFrame(() => {
        window.scrollTo(Number(saved.x || 0), Number(saved.y || 0));
      });
    } catch {
      sessionStorage.removeItem(scrollKey);
    }
  }

  function detailsId(details, index) {
    const title = details.querySelector(".summary-title")?.textContent?.trim() || "";
    const heading = details.closest(".panel")?.querySelector("h2")?.textContent?.trim() || "";
    return `${heading}:${title}:${index}`;
  }

  function readDetailsState() {
    try {
      return JSON.parse(sessionStorage.getItem(detailsKey) || "{}") || {};
    } catch {
      return {};
    }
  }

  function restoreDetailsState() {
    const state = readDetailsState();
    document.querySelectorAll("details.collapsible-course").forEach((details, index) => {
      const id = detailsId(details, index);
      if (Object.prototype.hasOwnProperty.call(state, id)) {
        details.open = Boolean(state[id]);
      }
    });
  }

  function bindDetailsState() {
    document.querySelectorAll("details.collapsible-course").forEach((details, index) => {
      details.addEventListener("toggle", () => {
        const state = readDetailsState();
        state[detailsId(details, index)] = details.open;
        try {
          sessionStorage.setItem(detailsKey, JSON.stringify(state));
        } catch {
          // Ignore storage failures.
        }
      });
    });
  }

  function activeElementIsInteractive() {
    const active = document.activeElement;
    if (!active) {
      return false;
    }

    return Boolean(active.closest("input, textarea, select, button, [contenteditable='true']"));
  }

  function shouldSkipAutoRefresh() {
    return document.hidden || formDirty || activeElementIsInteractive();
  }

  document.addEventListener("DOMContentLoaded", () => {
    restoreDetailsState();
    restoreScroll();
    bindDetailsState();

    document.querySelectorAll("form").forEach((form) => {
      form.addEventListener("submit", () => saveScroll("form-submit"));
    });

    document.querySelectorAll("a[href^='/instructor'], a[href^='?']").forEach((link) => {
      link.addEventListener("click", () => saveScroll("link"));
    });

    document.querySelectorAll("input:not([type='hidden']), textarea, select").forEach((control) => {
      control.addEventListener("input", () => {
        formDirty = true;
      });
      control.addEventListener("change", () => {
        formDirty = true;
      });
    });
  });

  window.addEventListener("pagehide", () => saveScroll("pagehide"));

  window.setInterval(() => {
    if (shouldSkipAutoRefresh()) {
      return;
    }

    saveScroll("auto-refresh");
    window.location.reload();
  }, refreshMs);
})();
