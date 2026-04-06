// Smart Jira Summarizer - Content Script
// Scrapes Jira board/backlog/epic data from the active page

(function () {
  if (window.__jiraSummarizerLoaded) return;
  window.__jiraSummarizerLoaded = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrapeJira") {
      const data = scrapeJiraPage();
      sendResponse(data);
    }
    if (request.action === "debugScrape") {
      const data = debugDomStructure();
      sendResponse(data);
    }
    return true;
  });

  function scrapeJiraPage() {
    const result = {
      boardName: "",
      sprintName: "",
      issues: [],
      epics: [],
      pageType: detectPageType()
    };

    result.boardName = extractBoardName();
    result.sprintName = extractSprintName();

    switch (result.pageType) {
      case "board":
        result.issues = scrapeBoardView();
        break;
      case "backlog":
        result.issues = scrapeBacklogView();
        break;
      case "roadmap":
      case "timeline":
        result.epics = scrapeRoadmapView();
        break;
      default:
        result.issues = scrapeBoardView();
        if (result.issues.length === 0) result.issues = scrapeBacklogView();
        if (result.issues.length === 0) result.epics = scrapeRoadmapView();
    }

    // Deduplicate by issue key
    result.issues = deduplicateIssues(result.issues);

    return result;
  }

  // ─── Debug: capture DOM structure to help diagnose scraping issues ───
  function debugDomStructure() {
    const info = {
      url: window.location.href,
      pageType: detectPageType(),
      columnSelectors: {},
      cardCount: {},
      sampleCard: null,
      sampleColumn: null
    };

    // Test various column selectors
    const colSelectors = {
      "software-board column": '[data-testid*="software-board"] [data-testid*="column"]',
      "data-testid column": '[data-testid*="column"]',
      "ghx-column": '.ghx-column',
      "droppable-id": '[data-rbd-droppable-id]',
      "role=listbox": '[role="listbox"]',
      "role=list": '[role="list"]',
      "section with heading": 'section:has(h2)',
      "div with role=group": '[role="group"]'
    };

    for (const [name, sel] of Object.entries(colSelectors)) {
      try {
        const els = document.querySelectorAll(sel);
        info.columnSelectors[name] = els.length;
        if (els.length > 0 && !info.sampleColumn) {
          const el = els[0];
          info.sampleColumn = {
            tag: el.tagName,
            testid: el.getAttribute("data-testid") || "",
            classes: el.className?.toString().substring(0, 200) || "",
            childCount: el.children.length,
            headingText: (el.querySelector("h2, h3, [role='heading']") || {}).textContent?.trim() || ""
          };
        }
      } catch (e) {
        info.columnSelectors[name] = "error: " + e.message;
      }
    }

    // Test card selectors
    const cardSelectors = {
      "software-board card": '[data-testid*="software-board.card"]',
      "platform-card": '[data-testid*="platform-card"]',
      "data-testid card": '[data-testid*="card"]',
      "ghx-issue": '.ghx-issue',
      "a[href*=browse]": 'a[href*="/browse/"]',
      "data-testid issue": '[data-testid*="issue"]',
      "lozenge (status)": '[class*="lozenge"], [data-testid*="lozenge"]',
      "status badge": '[data-testid*="status"]'
    };

    for (const [name, sel] of Object.entries(cardSelectors)) {
      try {
        info.cardCount[name] = document.querySelectorAll(sel).length;
      } catch (e) {
        info.cardCount[name] = "error: " + e.message;
      }
    }

    // Grab a sample card's structure
    const sampleCardEl = document.querySelector('[data-testid*="card"]') ||
                          document.querySelector('.ghx-issue');
    if (sampleCardEl) {
      info.sampleCard = {
        tag: sampleCardEl.tagName,
        testid: sampleCardEl.getAttribute("data-testid") || "",
        classes: sampleCardEl.className?.toString().substring(0, 200) || "",
        innerHTML: sampleCardEl.innerHTML.substring(0, 500),
        parentTestid: sampleCardEl.parentElement?.getAttribute("data-testid") || "",
        parentClasses: sampleCardEl.parentElement?.className?.toString().substring(0, 200) || ""
      };
    }

    return info;
  }

  function deduplicateIssues(issues) {
    const seen = new Set();
    return issues.filter((issue) => {
      if (!issue.key && !issue.summary) return false;
      if (issue.summary && issue.summary.length > 300) return false;

      const id = issue.key || issue.summary;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function detectPageType() {
    const url = window.location.href;
    if (url.includes("/board")) return "board";
    if (url.includes("/backlog")) return "backlog";
    if (url.includes("/roadmap") || url.includes("/timeline")) return "roadmap";
    if (url.includes("/plan")) return "roadmap";
    return "unknown";
  }

  function extractBoardName() {
    const selectors = [
      '[data-testid="software-board.header.title.container"] span',
      '[data-testid="board-header.title"]',
      'h1[data-test-id="board-header"]',
      '[data-testid="software-backlog.header"]',
      'header h1',
      '[data-testid="navigation-apps.project-switcher-v2"] span',
      'nav [data-testid*="project"] span'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }

    const title = document.title;
    if (title.includes("-")) return title.split("-")[0].trim();
    return title || "Unknown Project";
  }

  function extractSprintName() {
    const selectors = [
      '[data-testid="software-board.header.sprint-name"]',
      '[data-testid*="sprint-header"] span',
      '[data-testid="software-backlog.sprint-header"] span',
      '.ghx-sprint-name',
      '[class*="sprint"] h2',
      '[class*="Sprint"] h2'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return "";
  }

  // ─── Board View Scraping ──────────────────────────────────
  function scrapeBoardView() {
    const issues = [];

    // Strategy 1: Find columns and extract cards with column status
    const columnStrategies = [
      '[data-testid*="software-board.board"] [data-testid*="column"]',
      '[data-testid*="column"]',
      '.ghx-column',
    ];

    for (const colSelector of columnStrategies) {
      const columns = document.querySelectorAll(colSelector);
      if (columns.length === 0) continue;

      columns.forEach((column) => {
        const statusName = extractColumnName(column);

        // Find cards within this column
        const cards = findCardsInContainer(column);
        cards.forEach((card) => {
          const issue = extractIssueFromCard(card, statusName);
          if (issue.key || issue.summary) issues.push(issue);
        });
      });

      if (issues.length > 0) return issues;
    }

    // Strategy 2: Find all cards globally, extract status from each card directly
    const allCards = findCardsGlobally();
    allCards.forEach((card) => {
      const issue = extractIssueFromCard(card, "");
      if (issue.key || issue.summary) {
        // If status is still empty, try to derive from parent column
        if (!issue.status || issue.status === "") {
          issue.status = getStatusFromParentColumn(card) || "Unknown";
        }
        issues.push(issue);
      }
    });

    return issues;
  }

  function extractColumnName(column) {
    // Try multiple ways to get the column/status name
    const headerSelectors = [
      '[data-testid*="column-header"]',
      '[data-testid*="column.header"]',
      '.ghx-column-title',
      'h2',
      'h3',
      '[role="heading"]',
      '[data-testid*="header"]'
    ];

    for (const sel of headerSelectors) {
      const el = column.querySelector(sel);
      if (el && el.textContent.trim()) {
        // Clean: remove issue counts like "(3)" from "In Progress (3)"
        return el.textContent.trim().replace(/\s*\(\d+\)\s*$/, '').trim();
      }
    }

    // Try the column's own attributes
    const label = column.getAttribute("aria-label") || column.getAttribute("title") || "";
    if (label) return label.replace(/\s*\(\d+\)\s*$/, '').trim();

    return "Unknown";
  }

  function findCardsInContainer(container) {
    const cardSelectors = [
      '[data-testid*="software-board.card"]',
      '[data-testid*="platform-card"]',
      '[data-testid*="card-container"]',
      '.ghx-issue',
    ];

    for (const sel of cardSelectors) {
      const cards = container.querySelectorAll(sel);
      if (cards.length > 0) return Array.from(cards);
    }

    // Fallback: look for elements containing issue key links
    const links = container.querySelectorAll('a[href*="/browse/"]');
    if (links.length > 0) {
      // Return the closest card-like parent of each link
      const cards = new Set();
      links.forEach((link) => {
        // Walk up to find a reasonable card container (stop at the column)
        let el = link.parentElement;
        while (el && el !== container) {
          if (el.getAttribute("data-testid") || el.getAttribute("draggable") === "true") {
            cards.add(el);
            break;
          }
          el = el.parentElement;
        }
        if (!cards.has(link.parentElement) && el === container) {
          cards.add(link.parentElement);
        }
      });
      return Array.from(cards);
    }

    return [];
  }

  function findCardsGlobally() {
    const selectors = [
      '[data-testid*="software-board.card"]',
      '[data-testid*="platform-card"]',
      '.ghx-issue',
    ];

    for (const sel of selectors) {
      const cards = document.querySelectorAll(sel);
      if (cards.length > 0) return Array.from(cards);
    }

    // Last resort: find draggable elements that contain issue key links
    const draggables = document.querySelectorAll('[draggable="true"]');
    const issueCards = Array.from(draggables).filter((el) =>
      el.querySelector('a[href*="/browse/"]')
    );
    if (issueCards.length > 0) return issueCards;

    return [];
  }

  function getStatusFromParentColumn(card) {
    // Walk up from the card to find a column, then extract its name
    let el = card.parentElement;
    while (el) {
      const testid = el.getAttribute("data-testid") || "";
      if (testid.includes("column")) {
        return extractColumnName(el);
      }
      if (el.classList && (el.classList.contains("ghx-column"))) {
        return extractColumnName(el);
      }
      el = el.parentElement;
    }
    return null;
  }

  // ─── Backlog View Scraping ────────────────────────────────
  function scrapeBacklogView() {
    const issues = [];

    const rows = document.querySelectorAll(
      '[data-testid*="software-backlog.backlog-content"] [data-testid*="issue"], [data-testid*="backlog-issue"], .ghx-backlog-card, tr[data-issuekey]'
    );

    rows.forEach((row) => {
      const issue = extractIssueFromRow(row);
      if (issue.key || issue.summary) issues.push(issue);
    });

    if (issues.length === 0) {
      const listItems = document.querySelectorAll(
        '[data-testid*="issue-table"] tr[data-testid*="issue"], [data-testid*="list-row"]'
      );
      listItems.forEach((item) => {
        const issue = extractIssueFromRow(item);
        if (issue.key || issue.summary) issues.push(issue);
      });
    }

    return issues;
  }

  // ─── Roadmap View Scraping ────────────────────────────────
  function scrapeRoadmapView() {
    const epics = [];

    const epicRows = document.querySelectorAll(
      '[data-testid*="roadmap"] [data-testid*="row"], [data-testid*="timeline"] [data-testid*="row"], [class*="epic-row"]'
    );

    epicRows.forEach((row) => {
      const nameEl = row.querySelector('[data-testid*="summary"], [class*="summary"], span');
      const progressEl = row.querySelector('[data-testid*="progress"], [class*="progress"]');

      if (nameEl) {
        const epic = {
          name: nameEl.textContent.trim(),
          done: 0,
          total: 0
        };

        if (progressEl) {
          const progressText = progressEl.textContent.trim();
          const match = progressText.match(/(\d+)\s*(?:of|\/)\s*(\d+)/);
          if (match) {
            epic.done = parseInt(match[1]);
            epic.total = parseInt(match[2]);
          }
        }

        epics.push(epic);
      }
    });

    return epics;
  }

  // ─── Card-level extraction ────────────────────────────────
  function extractIssueFromCard(card, defaultStatus) {
    const issue = {
      key: "",
      summary: "",
      status: "",
      type: "Task",
      priority: "Medium",
      assignee: "",
      epicName: "",
      storyPoints: null,
      flagged: false
    };

    // ── Key ──
    const keyEl = card.querySelector(
      '[data-testid*="key"], [data-testid*="issue-key"], .ghx-key, [class*="issueKey"]'
    );
    if (keyEl) issue.key = keyEl.textContent.trim();

    if (!issue.key) {
      const link = card.querySelector('a[href*="/browse/"]');
      if (link) {
        const match = link.href.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/);
        if (match) issue.key = match[1];
        if (!issue.summary) issue.summary = link.textContent.trim();
      }
    }

    // ── Summary ──
    const summaryEl = card.querySelector(
      '[data-testid*="summary"], .ghx-summary, [class*="summary"], [class*="Summary"]'
    );
    if (summaryEl) issue.summary = summaryEl.textContent.trim();

    if (!issue.summary) {
      const textContent = card.textContent.trim();
      if (textContent.length < 200) issue.summary = textContent;
    }

    // ── Status (from the card itself) ──
    // Jira shows status as a lozenge/badge on each card
    const statusSelectors = [
      '[data-testid*="status"] span',
      '[data-testid*="status"]',
      '[class*="lozenge"]',
      '[class*="Lozenge"]',
      '[class*="statusCategory"]',
      '[class*="status-lozenge"]',
      'span[class*="status"]',
      '.ghx-status',
    ];

    for (const sel of statusSelectors) {
      const el = card.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        // Only use if it looks like a real status (short text, not a class name)
        if (text && text.length < 30 && text.length > 0) {
          issue.status = text;
          break;
        }
      }
    }

    // If no card-level status found, use the column-derived status
    if (!issue.status) {
      issue.status = defaultStatus || "Unknown";
    }

    // ── Type ──
    const typeSelectors = [
      '[data-testid*="issue-type"] img',
      '[data-testid*="type"] img',
      '[data-testid*="issue-type"]',
      '[data-testid*="type"]',
      '.ghx-type',
      '[class*="issueType"]'
    ];
    for (const sel of typeSelectors) {
      const el = card.querySelector(sel);
      if (el) {
        const title = el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("aria-label") || el.textContent.trim();
        if (title && title.length < 30) { issue.type = title; break; }
      }
    }

    // ── Priority ──
    const prioritySelectors = [
      '[data-testid*="priority"] img',
      '[data-testid*="priority"]',
      '.ghx-priority',
      '[class*="priority"]'
    ];
    for (const sel of prioritySelectors) {
      const el = card.querySelector(sel);
      if (el) {
        const title = el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("aria-label") || el.textContent.trim();
        if (title && title.length < 30) { issue.priority = title; break; }
      }
    }

    // ── Assignee ──
    const assigneeSelectors = [
      '[data-testid*="assignee"] img',
      '[data-testid*="avatar"] img',
      '[data-testid*="assignee"]',
      '.ghx-avatar img',
      '[class*="assignee"]'
    ];
    for (const sel of assigneeSelectors) {
      const el = card.querySelector(sel);
      if (el) {
        const name = el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("aria-label") || el.textContent.trim();
        if (name && name.length < 60 && name !== "Unassigned") {
          issue.assignee = name;
          break;
        }
      }
    }

    // ── Story Points ──
    const spEl = card.querySelector(
      '[data-testid*="story-point"], [data-testid*="estimate"], .ghx-estimate, [class*="storyPoint"]'
    );
    if (spEl) {
      const sp = parseFloat(spEl.textContent.trim());
      if (!isNaN(sp)) issue.storyPoints = sp;
    }

    // ── Epic ──
    const epicEl = card.querySelector(
      '[data-testid*="epic"], .ghx-epic-label, [class*="epic"]'
    );
    if (epicEl) issue.epicName = epicEl.textContent.trim();

    // ── Flagged ──
    const flagEl = card.querySelector(
      '[data-testid*="flag"], .ghx-flagged, [class*="flag"]'
    );
    if (flagEl) issue.flagged = true;

    return issue;
  }

  // ─── Row-level extraction (backlog/list) ──────────────────
  function extractIssueFromRow(row) {
    const issue = {
      key: "",
      summary: "",
      status: "Unknown",
      type: "Task",
      priority: "Medium",
      assignee: "",
      epicName: "",
      storyPoints: null,
      flagged: false
    };

    issue.key = row.getAttribute("data-issuekey") || row.getAttribute("data-issue-key") || "";

    if (!issue.key) {
      const keyEl = row.querySelector(
        '[data-testid*="key"], [class*="issueKey"], a[href*="browse/"]'
      );
      if (keyEl) {
        const link = keyEl.closest("a") || keyEl.querySelector("a") || keyEl;
        if (link.href) {
          const match = link.href.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/);
          if (match) issue.key = match[1];
        }
        if (!issue.key) issue.key = keyEl.textContent.trim();
      }
    }

    // Summary
    const summaryEl = row.querySelector('[data-testid*="summary"], [class*="summary"]');
    if (summaryEl) issue.summary = summaryEl.textContent.trim();

    // Status - try multiple selectors
    const statusSelectors = [
      '[data-testid*="status"] span',
      '[data-testid*="status"]',
      '[class*="lozenge"]',
      '[class*="Lozenge"]',
      '[class*="status"]',
      '.ghx-status'
    ];
    for (const sel of statusSelectors) {
      const el = row.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text && text.length < 30) {
          issue.status = text;
          break;
        }
      }
    }

    // Type
    const typeEl = row.querySelector('[data-testid*="type"] img, [data-testid*="type"], [class*="type"]');
    if (typeEl) {
      const t = typeEl.getAttribute("alt") || typeEl.getAttribute("title") || typeEl.getAttribute("aria-label") || typeEl.textContent.trim();
      if (t && t.length < 30) issue.type = t;
    }

    // Priority
    const prioEl = row.querySelector('[data-testid*="priority"] img, [data-testid*="priority"], [class*="priority"]');
    if (prioEl) {
      const p = prioEl.getAttribute("alt") || prioEl.getAttribute("title") || prioEl.getAttribute("aria-label") || prioEl.textContent.trim();
      if (p && p.length < 30) issue.priority = p;
    }

    // Assignee
    const assigneeEl = row.querySelector('[data-testid*="assignee"] img, [data-testid*="assignee"], [class*="assignee"]');
    if (assigneeEl) {
      issue.assignee = assigneeEl.getAttribute("alt") || assigneeEl.getAttribute("title") || assigneeEl.textContent.trim();
    }

    // Story points
    const spEl = row.querySelector('[data-testid*="estimate"], [class*="storyPoint"], [class*="estimate"]');
    if (spEl) {
      const sp = parseFloat(spEl.textContent.trim());
      if (!isNaN(sp)) issue.storyPoints = sp;
    }

    return issue;
  }
})();
