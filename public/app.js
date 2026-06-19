(function () {
  const isInstructorPage = window.location.pathname === "/instructor";
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

  function bindDirectoryLookup(config) {
    document.querySelectorAll(config.formSelector).forEach((form) => {
      const identifierInput = form.querySelector(config.identifierSelector);
      const nameInput = form.querySelector(config.nameSelector);
      const emailInput = form.querySelector(config.emailSelector);
      const status = form.querySelector(config.statusSelector);
      if (!identifierInput || !nameInput || !emailInput) {
        return;
      }

      let lookupTimer = null;
      let lookupController = null;
      let lookupInFlight = null;
      let lastLookupFound = false;
      let lastLookupIdentifier = "";

      function setStatus(message, tone) {
        if (!status) {
          return;
        }
        status.textContent = message || "";
        status.dataset.tone = tone || "";
      }

      function requestManualOverride(input) {
        if (!input.readOnly) {
          return;
        }

        const shouldEdit = window.confirm(
          `${config.label} name and email should normally come from UNC Directory. Do you want to manually edit this field?`
        );
        if (shouldEdit) {
          input.readOnly = false;
          input.dataset.manualEdited = "true";
          input.focus();
        }
      }

      nameInput.addEventListener("focus", () => requestManualOverride(nameInput));
      emailInput.addEventListener("focus", () => requestManualOverride(emailInput));

      nameInput.addEventListener("input", () => {
        if (nameInput.dataset.programmatic !== "true") {
          nameInput.dataset.manualEdited = "true";
        }
      });

      emailInput.addEventListener("input", () => {
        if (emailInput.dataset.programmatic !== "true") {
          emailInput.dataset.manualEdited = "true";
        }
      });

      function clearProfileFields() {
        nameInput.dataset.programmatic = "true";
        emailInput.dataset.programmatic = "true";
        nameInput.value = "";
        emailInput.value = "";
        nameInput.dataset.programmatic = "false";
        emailInput.dataset.programmatic = "false";
        nameInput.readOnly = true;
        emailInput.readOnly = true;
        nameInput.dataset.manualEdited = "false";
        emailInput.dataset.manualEdited = "false";
      }

      function applyProfile(profile, options = {}) {
        const showNoResult = options.showNoResult === true;
        if (!profile || profile.found === false) {
          lastLookupFound = false;
          clearProfileFields();
          setStatus(
            showNoResult
              ? "No unique UNC Directory result was found. Check the ONYEN or email before adding."
              : "No exact directory match yet.",
            showNoResult ? "warning" : "muted"
          );
          return;
        }

        lastLookupFound = true;
        setStatus("UNC Directory match found.", "success");
        const nextName = String(profile[config.nameKey] || "").trim();
        const nextEmail = String(profile[config.emailKey] || "").trim();
        const currentName = nameInput.value.trim();
        const currentEmail = emailInput.value.trim();
        const nameWouldChange = nextName && currentName && currentName !== nextName;
        const emailWouldChange = nextEmail && currentEmail && currentEmail !== nextEmail;
        const needsConfirmation =
          (nameInput.dataset.manualEdited === "true" && nameWouldChange) ||
          (emailInput.dataset.manualEdited === "true" && emailWouldChange);

        if (needsConfirmation) {
          const shouldReplace = window.confirm(
            `UNC Directory found a different ${config.label.toLowerCase()} name or email. Replace the current values with the directory result?`
          );
          if (!shouldReplace) {
            return;
          }
        }

        if (nextEmail) {
          emailInput.dataset.programmatic = "true";
          emailInput.value = nextEmail;
          emailInput.dataset.programmatic = "false";
          emailInput.readOnly = true;
          emailInput.dataset.manualEdited = "false";
        }
        if (nextName) {
          nameInput.dataset.programmatic = "true";
          nameInput.value = nextName;
          nameInput.dataset.programmatic = "false";
          nameInput.readOnly = true;
          nameInput.dataset.manualEdited = "false";
        }
      }

      function runLookup(options = {}) {
        const identifier = identifierInput.value.trim();
        if (!identifier) {
          setStatus("", "");
          lastLookupFound = false;
          lastLookupIdentifier = "";
          clearProfileFields();
          return Promise.resolve(null);
        }

        const looksLikeEmail = identifier.includes("@");
        const hasCompleteEmailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
        if ((looksLikeEmail && !hasCompleteEmailShape) || (!looksLikeEmail && identifier.length < 3)) {
          setStatus("", "");
          lastLookupFound = false;
          lastLookupIdentifier = identifier;
          clearProfileFields();
          return Promise.resolve(null);
        }

        if (lookupController) {
          lookupController.abort();
        }
        lookupController = new AbortController();
        lastLookupIdentifier = identifier;
        setStatus("Checking UNC Directory...", "muted");

        lookupInFlight = fetch(`${config.endpoint}?identifier=${encodeURIComponent(identifier)}`, {
          signal: lookupController.signal,
          headers: { Accept: "application/json" }
        })
          .then((response) => (response.ok ? response.json() : null))
          .then((profile) => {
            if (identifierInput.value.trim() !== identifier) {
              return null;
            }
            if (profile) {
              applyProfile(profile, options);
            }
            return profile;
          })
          .catch((error) => {
            if (error?.name !== "AbortError") {
              setStatus("Could not check UNC Directory. Try again before adding.", "warning");
            }
            return null;
          })
          .finally(() => {
            lookupInFlight = null;
          });

        return lookupInFlight;
      }

      identifierInput.addEventListener("input", () => {
        lastLookupFound = false;
        lastLookupIdentifier = "";
        form.dataset.lookupReadySubmit = "false";
        clearProfileFields();
        setStatus("", "");
        window.clearTimeout(lookupTimer);
        lookupTimer = window.setTimeout(() => runLookup({ showNoResult: false }), 1000);
      });
      identifierInput.addEventListener("blur", () => runLookup({ showNoResult: true }));

      form.addEventListener("submit", async (event) => {
        if (form.dataset.lookupReadySubmit === "true") {
          return;
        }

        event.preventDefault();
        const identifier = identifierInput.value.trim();
        if (!identifier) {
          return;
        }

        if (identifier !== lastLookupIdentifier || lookupInFlight) {
          window.clearTimeout(lookupTimer);
          await runLookup({ showNoResult: true });
        }

        if (!lastLookupFound && (!nameInput.value.trim() || !emailInput.value.trim())) {
          window.alert(`No unique UNC Directory result was found. Please check the ${config.label} ONYEN or email before adding.`);
          return;
        }

        form.dataset.lookupReadySubmit = "true";
        form.requestSubmit();
      });
    });
  }

  function bindStaffLookups() {
    bindDirectoryLookup({
      endpoint: "/api/professors/lookup",
      emailKey: "professorEmail",
      emailSelector: "[data-professor-email]",
      formSelector: "form.professor-form",
      identifierSelector: "[data-professor-identifier]",
      label: "Professor",
      nameKey: "professorName",
      nameSelector: "[data-professor-name]",
      statusSelector: "[data-professor-lookup-status]"
    });

    bindDirectoryLookup({
      endpoint: "/api/tas/lookup",
      emailKey: "taEmail",
      emailSelector: "[data-ta-email]",
      formSelector: "form.ta-form",
      identifierSelector: "[data-ta-identifier]",
      label: "TA",
      nameKey: "taName",
      nameSelector: "[data-ta-name]",
      statusSelector: "[data-ta-lookup-status]"
    });
  }

  function bindRichEditors() {
    document.querySelectorAll("[data-rich-editor]").forEach((editor) => {
      const form = editor.closest("form");
      const htmlInput = form?.querySelector("[data-rich-html]");
      const textInput = form?.querySelector("[data-rich-text]");
      if (!form || !htmlInput || !textInput) {
        return;
      }

      function syncEditorFields() {
        htmlInput.value = editor.innerHTML.trim();
        textInput.value = editor.innerText.trim();
        if (textInput.value) {
          editor.dataset.invalid = "false";
        }
      }

      editor.addEventListener("input", syncEditorFields);
      editor.addEventListener("blur", syncEditorFields);

      form.querySelectorAll("[data-rich-command]").forEach((button) => {
        button.addEventListener("click", () => {
          editor.focus();
          const command = button.dataset.richCommand;
          if (command === "createLink") {
            const url = window.prompt("Enter a link URL");
            if (url) {
              document.execCommand(command, false, url);
            }
          } else {
            document.execCommand(command, false, null);
          }
          syncEditorFields();
        });
      });

      form.addEventListener("submit", (event) => {
        syncEditorFields();
        if (!textInput.value) {
          event.preventDefault();
          editor.focus();
          editor.dataset.invalid = "true";
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindRichEditors();

    if (isInstructorPage) {
      restoreDetailsState();
      restoreScroll();
      bindDetailsState();
      bindStaffLookups();

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
    }
  });

  if (isInstructorPage) {
    window.addEventListener("pagehide", () => saveScroll("pagehide"));

    window.setInterval(() => {
      if (shouldSkipAutoRefresh()) {
        return;
      }

      saveScroll("auto-refresh");
      window.location.reload();
    }, refreshMs);
  }
})();
