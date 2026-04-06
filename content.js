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
        // Try all methods and use whichever returns data
        result.issues = scrapeBoardView();
        if (result.issues.length === 0) result.issues = scrapeBacklogView();
        if (result.issues.length === 0) result.epics = scrapeRoadmapView();
    }

    // Deduplicate by issue key
    result.issues = deduplicateIssues(result.issues);

    return result;
  }

  function deduplicateIssues(issues) {
    const seen = new Set();
    return issues.filter((issue) => {
      // Skip items with no key and no meaningful summary
      if (!issue.key && !issue.summary) return false;
      // Skip items where the "summary" is too long (likely scraped garbage)
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

  function scrapeBoardView() {
    const issues = [];

    // Jira Cloud board - find actual columns (not every droppable zone)
    const columns = document.querySelectorAll(
      '[data-testid*="software-board.board"] [data-testid*="column"], .ghx-column'
    );

    if (columns.length > 0) {
      columns.forEach((column) => {
        const columnHeader =
          column.querySelector('[data-testid*="column-header"], .ghx-column-title, h2') ||
          column.closest('[data-testid*="column"]')?.querySelector('h2, [role="heading"]');

        const statusName = columnHeader ? columnHeader.textContent.trim() : "Unknown";

        // Only grab direct card elements, not nested sub-elements
        const cards = column.querySelectorAll(
          ':scope > [data-testid*="card"], [data-testid*="software-board.card-container"], .ghx-issue'
        );

        cards.forEach((card) => {
          const issue = extractIssueFromCard(card, statusName);
          if (issue.key || issue.summary) issues.push(issue);
        });
      });
    }

    // Fallback: look for card elements with issue keys (more targeted)
    if (issues.length === 0) {
      const allCards = document.querySelectorAll(
        '[data-testid*="software-board.card"], [data-testid*="platform-card"], .ghx-issue'
      );
      allCards.forEach((card) => {
        // Skip if this card is nested inside another card we already found
        if (card.closest('[data-testid*="software-board.card"]') !== card &&
            card.matches('[data-testid*="software-board.card"]')) return;

        const issue = extractIssueFromCard(card, "Unknown");
        if (issue.key || issue.summary) issues.push(issue);
      });
    }

    return issues;
  }

  function scrapeBacklogView() {
    const issues = [];

    // Primary: Jira backlog issue rows
    const rows = document.querySelectorAll(
      '[data-testid*="software-backlog.backlog-content"] [data-testid*="issue"], [data-testid*="backlog-issue"], .ghx-backlog-card, tr[data-issuekey]'
    );

    rows.forEach((row) => {
      const issue = extractIssueFromRow(row);
      if (issue.key || issue.summary) issues.push(issue);
    });

    // Fallback: list view with issue links (but NOT generic role="row")
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

  function extractIssueFromCard(card, defaultStatus) {
    const issue = {
      key: "",
      summary: "",
      status: defaultStatus,
      type: "Task",
      priority: "Medium",
      assignee: "",
      epicName: "",
      storyPoints: null,
      flagged: false
    };

    // Key - look for issue key pattern (e.g., PROJ-123)
    const keyEl = card.querySelector(
      '[data-testid*="key"], [data-testid*="issue-key"], .ghx-key, [class*="issueKey"]'
    );
    if (keyEl) issue.key = keyEl.textContent.trim();

    // If no key found via selector, try to find it from any link with /browse/
    if (!issue.key) {
      const link = card.querySelector('a[href*="/browse/"]');
      if (link) {
        const match = link.href.match(/\/browse\/([A-Z]+-\d+)/);
        if (match) issue.key = match[1];
        if (!issue.summary) issue.summary = link.textContent.trim();
      }
    }

    // Summary
    const summaryEl = card.querySelector(
      '[data-testid*="summary"], .ghx-summary, [class*="summary"], [class*="Summary"]'
    );
    if (summaryEl) issue.summary = summaryEl.textContent.trim();

    // If no summary found, use short card text
    if (!issue.summary) {
      const textContent = card.textContent.trim();
      if (textContent.length < 200) issue.summary = textContent;
    }

    // Type
    const typeEl = card.querySelector(
      '[data-testid*="type"], .ghx-type, [class*="issueType"]'
    );
    if (typeEl) {
      const title = typeEl.getAttribute("title") || typeEl.getAttribute("aria-label") || typeEl.textContent.trim();
      if (title) issue.type = title;
    }

    // Priority
    const priorityEl = card.querySelector(
      '[data-testid*="priority"], .ghx-priority, [class*="priority"]'
    );
    if (priorityEl) {
      const title = priorityEl.getAttribute("title") || priorityEl.getAttribute("aria-label") || priorityEl.textContent.trim();
      if (title) issue.priority = title;
    }

    // Assignee
    const assigneeEl = card.querySelector(
      '[data-testid*="assignee"], [data-testid*="avatar"], .ghx-avatar img, [class*="assignee"]'
    );
    if (assigneeEl) {
      issue.assignee = assigneeEl.getAttribute("title") ||
        assigneeEl.getAttribute("aria-label") ||
        assigneeEl.getAttribute("alt") ||
        assigneeEl.textContent.trim();
    }

    // Story points
    const spEl = card.querySelector(
      '[data-testid*="story-point"], [data-testid*="estimate"], .ghx-estimate, [class*="storyPoint"]'
    );
    if (spEl) {
      const sp = parseFloat(spEl.textContent.trim());
      if (!isNaN(sp)) issue.storyPoints = sp;
    }

    // Epic
    const epicEl = card.querySelector(
      '[data-testid*="epic"], .ghx-epic-label, [class*="epic"]'
    );
    if (epicEl) issue.epicName = epicEl.textContent.trim();

    // Flagged
    const flagEl = card.querySelector(
      '[data-testid*="flag"], .ghx-flagged, [class*="flag"]'
    );
    if (flagEl) issue.flagged = true;

    return issue;
  }

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

    // Try data attribute first
    issue.key = row.getAttribute("data-issuekey") || row.getAttribute("data-issue-key") || "";

    // Key from content
    if (!issue.key) {
      const keyEl = row.querySelector(
        '[data-testid*="key"], [class*="issueKey"], a[href*="browse/"]'
      );
      if (keyEl) {
        // Extract from link href if possible
        const link = keyEl.closest("a") || keyEl.querySelector("a") || keyEl;
        if (link.href) {
          const match = link.href.match(/\/browse\/([A-Z]+-\d+)/);
          if (match) issue.key = match[1];
        }
        if (!issue.key) issue.key = keyEl.textContent.trim();
      }
    }

    // Summary
    const summaryEl = row.querySelector(
      '[data-testid*="summary"], [class*="summary"]'
    );
    if (summaryEl) issue.summary = summaryEl.textContent.trim();

    // Status
    const statusEl = row.querySelector(
      '[data-testid*="status"], [class*="status"], [class*="lozenge"]'
    );
    if (statusEl) issue.status = statusEl.textContent.trim();

    // Type
    const typeEl = row.querySelector('[data-testid*="type"], [class*="type"]');
    if (typeEl) {
      const t = typeEl.getAttribute("title") || typeEl.getAttribute("aria-label") || typeEl.textContent.trim();
      if (t) issue.type = t;
    }

    // Priority
    const prioEl = row.querySelector('[data-testid*="priority"], [class*="priority"]');
    if (prioEl) {
      const p = prioEl.getAttribute("title") || prioEl.getAttribute("aria-label") || prioEl.textContent.trim();
      if (p) issue.priority = p;
    }

    // Assignee
    const assigneeEl = row.querySelector('[data-testid*="assignee"], [class*="assignee"]');
    if (assigneeEl) {
      issue.assignee = assigneeEl.getAttribute("title") || assigneeEl.textContent.trim();
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
