document.addEventListener("DOMContentLoaded", () => {
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const saveApiKeyBtn = document.getElementById("saveApiKey");
  const modelSelect = document.getElementById("modelSelect");
  const summarizeBtn = document.getElementById("summarizeBtn");
  const manualBtn = document.getElementById("manualBtn");
  const manualInput = document.getElementById("manualInput");
  const manualData = document.getElementById("manualData");
  const manualSummarize = document.getElementById("manualSummarize");
  const loading = document.getElementById("loading");
  const results = document.getElementById("results");
  const error = document.getElementById("error");
  const errorText = document.getElementById("errorText");
  const retryBtn = document.getElementById("retryBtn");
  const copyBtn = document.getElementById("copyBtn");
  const copyMdBtn = document.getElementById("copyMdBtn");
  const exportPdfBtn = document.getElementById("exportPdfBtn");
  const emailBtn = document.getElementById("emailBtn");
  const statusText = document.getElementById("statusText");
  const darkModeBtn = document.getElementById("darkModeBtn");
  const historyBtn = document.getElementById("historyBtn");
  const historyPanel = document.getElementById("historyPanel");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");

  let lastResult = null;
  let lastJiraData = null;

  // ─── Dark Mode ────────────────────────────────────────────
  chrome.storage.sync.get(["darkMode"], (data) => {
    if (data.darkMode) {
      document.body.classList.add("dark");
      updateDarkModeIcon(true);
    }
  });

  darkModeBtn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark");
    chrome.storage.sync.set({ darkMode: isDark });
    updateDarkModeIcon(isDark);
  });

  function updateDarkModeIcon(isDark) {
    const icon = document.getElementById("darkModeIcon");
    if (isDark) {
      icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    } else {
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    }
  }

  // ─── Tab Navigation ───────────────────────────────────────
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ─── Load Saved Settings ──────────────────────────────────
  chrome.storage.sync.get(["openRouterApiKey", "selectedModel"], (data) => {
    if (data.openRouterApiKey) {
      apiKeyInput.value = data.openRouterApiKey;
    }
    if (data.selectedModel) {
      modelSelect.value = data.selectedModel;
    }
  });

  // Check Jira page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes("atlassian.net")) {
      statusText.textContent = "Jira page detected. Ready to summarize!";
      statusText.style.color = "#00875a";
    } else {
      statusText.textContent = "Not on a Jira page. Use 'Paste Data Manually' instead.";
      summarizeBtn.disabled = true;
    }
  });

  // ─── Settings ─────────────────────────────────────────────
  settingsBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
    historyPanel.classList.add("hidden");
  });

  saveApiKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    chrome.storage.sync.set({ openRouterApiKey: key }, () => {
      saveApiKeyBtn.textContent = "Saved!";
      setTimeout(() => { saveApiKeyBtn.textContent = "Save"; }, 1500);
    });
  });

  modelSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ selectedModel: modelSelect.value });
  });

  // ─── History ──────────────────────────────────────────────
  historyBtn.addEventListener("click", () => {
    historyPanel.classList.toggle("hidden");
    settingsPanel.classList.add("hidden");
    if (!historyPanel.classList.contains("hidden")) {
      loadHistory();
    }
  });

  clearHistoryBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ action: "clearHistory" });
    loadHistory();
    showToast("History cleared");
  });

  async function loadHistory() {
    const response = await chrome.runtime.sendMessage({ action: "getHistory" });
    const list = document.getElementById("historyList");

    if (!response.success || !response.data.length) {
      list.innerHTML = '<p class="history-empty">No summaries saved yet.</p>';
      return;
    }

    list.innerHTML = "";
    for (const item of response.data) {
      const date = new Date(item.timestamp);
      const timeStr = date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const div = document.createElement("div");
      div.className = "history-item";
      div.innerHTML = `
        <div class="history-item-header">
          <strong>${escapeHtml(item.boardName)}</strong>
          <span class="history-time">${timeStr}</span>
        </div>
        <div class="history-item-meta">
          ${item.sprintName ? `<span>${escapeHtml(item.sprintName)}</span>` : ""}
          <span>${item.issueCount} issues</span>
          ${item.summary?.deliveryConfidence ? `<span class="rag-badge-sm ${item.summary.deliveryConfidence.toLowerCase()}">${item.summary.deliveryConfidence}</span>` : ""}
        </div>
        <div class="history-item-summary">${escapeHtml(item.summary?.summary || "")}</div>
        <div class="history-item-actions">
          <button class="btn-sm history-view-btn" data-id="${item.id}">View</button>
          <button class="btn-sm btn-danger history-delete-btn" data-id="${item.id}">Delete</button>
        </div>
      `;
      list.appendChild(div);
    }

    // Bind view/delete buttons
    list.querySelectorAll(".history-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = response.data.find(i => i.id === btn.dataset.id);
        if (item && item.summary) {
          lastResult = item.summary;
          showResults(item.summary);
          historyPanel.classList.add("hidden");
          // Switch to summarize tab
          document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
          document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
          document.querySelector('[data-tab="summarize"]').classList.add("active");
          document.getElementById("tab-summarize").classList.add("active");
        }
      });
    });

    list.querySelectorAll(".history-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await chrome.runtime.sendMessage({ action: "deleteHistoryItem", id: btn.dataset.id });
        loadHistory();
        showToast("Entry deleted");
      });
    });
  }

  // ─── Manual Input ─────────────────────────────────────────
  manualBtn.addEventListener("click", () => {
    manualInput.classList.toggle("hidden");
  });

  // ─── Summarize from Jira ──────────────────────────────────
  summarizeBtn.addEventListener("click", async () => {
    showLoading();

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
      } catch (e) {
        // Content script may already be injected
      }

      const jiraData = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: "scrapeJira" }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error("Could not read Jira page. Try refreshing the page."));
          } else {
            resolve(response);
          }
        });
      });

      if ((!jiraData.issues || jiraData.issues.length === 0) &&
          (!jiraData.epics || jiraData.epics.length === 0)) {
        showError("No issues found on this page. Try navigating to a board, backlog, or roadmap view. Or use 'Paste Data Manually'.");
        return;
      }

      lastJiraData = jiraData;
      statusText.textContent = `Found ${jiraData.issues.length} issues, ${jiraData.epics.length} epics.`;

      await sendToAI(jiraData);
    } catch (err) {
      showError(err.message);
    }
  });

  // ─── Summarize from Manual Input ──────────────────────────
  manualSummarize.addEventListener("click", async () => {
    const text = manualData.value.trim();
    if (!text) return;

    showLoading();

    const jiraData = {
      boardName: "Manual Input",
      sprintName: "",
      issues: [],
      epics: [],
      rawText: text
    };

    lastJiraData = jiraData;
    await sendToAI(jiraData);
  });

  async function sendToAI(jiraData) {
    try {
      const { selectedModel } = await chrome.storage.sync.get(["selectedModel"]);
      const model = selectedModel || "google/gemini-2.0-flash-001";

      const dataToSend = jiraData.rawText ? {
        ...jiraData,
        issues: [{ key: "MANUAL", summary: jiraData.rawText, status: "N/A", type: "N/A", priority: "N/A" }]
      } : jiraData;

      const response = await chrome.runtime.sendMessage({
        action: "summarize",
        data: dataToSend,
        model: model
      });

      if (response.success) {
        lastResult = response.data;
        showResults(response.data);

        // Save to history
        chrome.runtime.sendMessage({
          action: "saveHistory",
          entry: {
            boardName: jiraData.boardName,
            sprintName: jiraData.sprintName,
            issueCount: jiraData.issues?.length || 0,
            summary: response.data,
            velocityMetrics: response.data.velocityMetrics || null
          }
        });

        // Update workload tab
        if (response.data.teamWorkload) {
          renderWorkload(response.data.teamWorkload);
        }

        // Update velocity tab
        if (response.data.velocityMetrics) {
          renderVelocity(response.data.velocityMetrics, jiraData);
        }
      } else {
        showError(response.error);
      }
    } catch (err) {
      showError(err.message);
    }
  }

  // ─── Show/Hide Helpers ────────────────────────────────────
  function showLoading() {
    loading.classList.remove("hidden");
    results.classList.add("hidden");
    error.classList.add("hidden");
  }

  function showError(msg) {
    loading.classList.add("hidden");
    results.classList.add("hidden");
    error.classList.remove("hidden");
    errorText.textContent = msg;
  }

  function showResults(data) {
    loading.classList.add("hidden");
    error.classList.add("hidden");
    results.classList.remove("hidden");

    document.getElementById("epicTitle").textContent = data.epicName || "Executive Summary";

    const badge = document.getElementById("ragBadge");
    const confidence = (data.deliveryConfidence || "green").toLowerCase();
    badge.textContent = data.deliveryConfidence || "Green";
    badge.className = "rag-badge " + confidence;

    const pct = Math.round(data.overallProgress || 0);
    document.getElementById("progressPct").textContent = pct + "%";
    const fill = document.getElementById("progressFill");
    fill.style.width = pct + "%";
    fill.className = "progress-fill" + (confidence !== "green" ? " " + confidence : "");

    const reasonEl = document.getElementById("confidenceReason");
    if (data.confidenceReason) {
      reasonEl.textContent = data.confidenceReason;
      reasonEl.classList.remove("hidden");
    } else {
      reasonEl.classList.add("hidden");
    }

    document.getElementById("summaryText").textContent = data.summary || "";

    // Sprint Health
    const healthSection = document.getElementById("sprintHealthSection");
    if (data.sprintHealth) {
      healthSection.classList.remove("hidden");
      const scopeBadge = document.getElementById("scopeBadge");
      scopeBadge.textContent = data.sprintHealth.scope || "-";
      scopeBadge.className = "health-value " + getHealthClass(data.sprintHealth.scope);

      const moraleBadge = document.getElementById("moraleBadge");
      moraleBadge.textContent = data.sprintHealth.teamMorale || "-";
      moraleBadge.className = "health-value " + getMoraleClass(data.sprintHealth.teamMorale);

      const scopeNote = document.getElementById("scopeNote");
      if (data.sprintHealth.scopeNote) {
        scopeNote.textContent = data.sprintHealth.scopeNote;
        scopeNote.classList.remove("hidden");
      } else {
        scopeNote.classList.add("hidden");
      }
    } else {
      healthSection.classList.add("hidden");
    }

    renderList("blockersSection", "blockersList", data.keyBlockers);
    renderList("risksSection", "risksList", data.risks);
    renderList("highlightsSection", "highlightsList", data.highlights);

    const recSection = document.getElementById("recommendationSection");
    const recText = document.getElementById("recommendationText");
    if (data.recommendation) {
      recText.textContent = data.recommendation;
      recSection.classList.remove("hidden");
    } else {
      recSection.classList.add("hidden");
    }
  }

  function getHealthClass(scope) {
    if (!scope) return "";
    if (scope === "Stable") return "health-green";
    if (scope === "Reduced") return "health-amber";
    return "health-red";
  }

  function getMoraleClass(morale) {
    if (!morale) return "";
    if (morale === "High") return "health-green";
    if (morale === "Medium") return "health-amber";
    return "health-red";
  }

  function renderList(sectionId, listId, items) {
    const section = document.getElementById(sectionId);
    const list = document.getElementById(listId);

    if (items && items.length > 0) {
      list.innerHTML = "";
      items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      });
      section.classList.remove("hidden");
    } else {
      section.classList.add("hidden");
    }
  }

  // ─── Team Workload ────────────────────────────────────────
  function renderWorkload(teamWorkload) {
    const container = document.getElementById("workloadContent");

    if (!teamWorkload || teamWorkload.length === 0) {
      container.innerHTML = '<p class="tab-placeholder">No team workload data available.</p>';
      return;
    }

    let html = '<div class="workload-grid">';

    for (const member of teamWorkload) {
      const completionPct = member.totalTasks > 0 ? Math.round((member.completed / member.totalTasks) * 100) : 0;
      const statusClass = member.workloadStatus === "Balanced" ? "balanced" :
                           member.workloadStatus === "Overloaded" ? "overloaded" : "underutilized";

      html += `
        <div class="workload-card">
          <div class="workload-card-header">
            <span class="workload-name">${escapeHtml(member.assignee)}</span>
            <span class="workload-status ${statusClass}">${member.workloadStatus}</span>
          </div>
          <div class="workload-stats">
            <div class="workload-stat">
              <span class="stat-num">${member.totalTasks}</span>
              <span class="stat-label">Total</span>
            </div>
            <div class="workload-stat">
              <span class="stat-num stat-done">${member.completed}</span>
              <span class="stat-label">Done</span>
            </div>
            <div class="workload-stat">
              <span class="stat-num stat-progress">${member.inProgress}</span>
              <span class="stat-label">In Progress</span>
            </div>
            <div class="workload-stat">
              <span class="stat-num stat-blocked">${member.blocked}</span>
              <span class="stat-label">Blocked</span>
            </div>
          </div>
          <div class="workload-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${completionPct}%"></div>
            </div>
            <span class="workload-pct">${completionPct}%</span>
          </div>
          ${member.storyPoints ? `<div class="workload-sp">${member.storyPoints} SP assigned</div>` : ""}
        </div>
      `;
    }

    html += "</div>";
    container.innerHTML = html;
  }

  // ─── Velocity Metrics ─────────────────────────────────────
  function renderVelocity(metrics, jiraData) {
    const container = document.getElementById("velocityContent");

    if (!metrics) {
      container.innerHTML = '<p class="tab-placeholder">No velocity data available.</p>';
      return;
    }

    const completionPct = Math.round(metrics.completionRate || 0);

    let html = `
      <div class="velocity-dashboard">
        <div class="velocity-header">
          <h3>${escapeHtml(jiraData?.sprintName || jiraData?.boardName || "Current Sprint")}</h3>
        </div>
        <div class="velocity-cards">
          <div class="velocity-card">
            <span class="velocity-num">${metrics.totalStoryPoints || 0}</span>
            <span class="velocity-label">Total SP</span>
          </div>
          <div class="velocity-card done">
            <span class="velocity-num">${metrics.completedStoryPoints || 0}</span>
            <span class="velocity-label">Completed SP</span>
          </div>
          <div class="velocity-card remaining">
            <span class="velocity-num">${metrics.remainingStoryPoints || 0}</span>
            <span class="velocity-label">Remaining SP</span>
          </div>
          <div class="velocity-card rate">
            <span class="velocity-num">${completionPct}%</span>
            <span class="velocity-label">Completion Rate</span>
          </div>
        </div>
        <div class="velocity-bar-section">
          <div class="velocity-bar-label">Sprint Burn Progress</div>
          <div class="velocity-bar">
            <div class="velocity-bar-fill" style="width: ${completionPct}%">
              <span class="velocity-bar-text">${completionPct}%</span>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // ─── Copy / Export ────────────────────────────────────────
  copyBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const text = formatPlainText(lastResult);
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!");
  });

  copyMdBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const md = formatMarkdown(lastResult);
    navigator.clipboard.writeText(md);
    showToast("Copied as Markdown!");
  });

  // Export as PDF (generates HTML and opens print dialog)
  exportPdfBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const pdfHtml = generatePdfHtml(lastResult);
    const blob = new Blob([pdfHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);

    chrome.tabs.create({ url: url }, (tab) => {
      // The user can use Ctrl+P / Cmd+P to save as PDF
    });

    showToast("Print page opened - use Ctrl+P to save as PDF");
  });

  // Email summary
  emailBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const subject = encodeURIComponent(`Sprint Summary: ${lastResult.epicName || "Executive Summary"}`);
    const body = encodeURIComponent(formatPlainText(lastResult));
    const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;

    chrome.tabs.create({ url: mailtoUrl });
  });

  // Retry
  retryBtn.addEventListener("click", () => {
    if (lastJiraData) {
      showLoading();
      sendToAI(lastJiraData);
    }
  });

  // ─── Formatters ───────────────────────────────────────────
  function formatPlainText(data) {
    let text = `=== ${data.epicName || "Executive Summary"} ===\n\n`;
    text += `Delivery Confidence: ${data.deliveryConfidence}\n`;
    text += `Overall Progress: ${data.overallProgress}%\n`;
    if (data.confidenceReason) text += `Reason: ${data.confidenceReason}\n`;
    text += `\n${data.summary}\n`;

    if (data.sprintHealth) {
      text += `\nSprint Health:\n`;
      text += `  Scope: ${data.sprintHealth.scope}\n`;
      text += `  Team Morale: ${data.sprintHealth.teamMorale}\n`;
      if (data.sprintHealth.scopeNote) text += `  Note: ${data.sprintHealth.scopeNote}\n`;
    }

    if (data.keyBlockers && data.keyBlockers.length) {
      text += `\nKey Blockers:\n`;
      data.keyBlockers.forEach((b) => { text += `  - ${b}\n`; });
    }
    if (data.risks && data.risks.length) {
      text += `\nRisks:\n`;
      data.risks.forEach((r) => { text += `  - ${r}\n`; });
    }
    if (data.highlights && data.highlights.length) {
      text += `\nHighlights:\n`;
      data.highlights.forEach((h) => { text += `  - ${h}\n`; });
    }
    if (data.recommendation) {
      text += `\nRecommendation: ${data.recommendation}\n`;
    }

    if (data.teamWorkload && data.teamWorkload.length) {
      text += `\nTeam Workload:\n`;
      data.teamWorkload.forEach((m) => {
        text += `  - ${m.assignee}: ${m.totalTasks} tasks (${m.completed} done, ${m.inProgress} in progress, ${m.blocked} blocked) [${m.workloadStatus}]\n`;
      });
    }

    if (data.velocityMetrics) {
      text += `\nVelocity: ${data.velocityMetrics.completedStoryPoints}/${data.velocityMetrics.totalStoryPoints} SP (${data.velocityMetrics.completionRate}%)\n`;
    }

    text += `\n---\nGenerated by SKT Jira Summarizer | ${new Date().toLocaleDateString()}\n`;
    return text;
  }

  function formatMarkdown(data) {
    const ragEmoji = { green: "🟢", amber: "🟡", red: "🔴" };
    const conf = (data.deliveryConfidence || "green").toLowerCase();

    let md = `## ${data.epicName || "Executive Summary"}\n\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| **Delivery Confidence** | ${ragEmoji[conf] || "⚪"} ${data.deliveryConfidence} |\n`;
    md += `| **Overall Progress** | ${data.overallProgress}% |\n`;

    if (data.sprintHealth) {
      md += `| **Scope** | ${data.sprintHealth.scope} |\n`;
      md += `| **Team Morale** | ${data.sprintHealth.teamMorale} |\n`;
    }
    md += `\n`;

    if (data.confidenceReason) md += `> ${data.confidenceReason}\n\n`;
    md += `${data.summary}\n\n`;

    if (data.keyBlockers && data.keyBlockers.length) {
      md += `### 🚫 Key Blockers\n`;
      data.keyBlockers.forEach((b) => { md += `- ${b}\n`; });
      md += `\n`;
    }
    if (data.risks && data.risks.length) {
      md += `### ⚠️ Risks\n`;
      data.risks.forEach((r) => { md += `- ${r}\n`; });
      md += `\n`;
    }
    if (data.highlights && data.highlights.length) {
      md += `### ✅ Highlights\n`;
      data.highlights.forEach((h) => { md += `- ${h}\n`; });
      md += `\n`;
    }
    if (data.recommendation) {
      md += `### 💡 Recommendation\n${data.recommendation}\n\n`;
    }

    if (data.teamWorkload && data.teamWorkload.length) {
      md += `### 👥 Team Workload\n`;
      md += `| Assignee | Tasks | Done | In Progress | Blocked | SP | Status |\n`;
      md += `|----------|-------|------|-------------|---------|-----|--------|\n`;
      data.teamWorkload.forEach((m) => {
        md += `| ${m.assignee} | ${m.totalTasks} | ${m.completed} | ${m.inProgress} | ${m.blocked} | ${m.storyPoints || 0} | ${m.workloadStatus} |\n`;
      });
      md += `\n`;
    }

    if (data.velocityMetrics) {
      md += `### 📊 Velocity\n`;
      md += `- **Completed:** ${data.velocityMetrics.completedStoryPoints}/${data.velocityMetrics.totalStoryPoints} SP\n`;
      md += `- **Completion Rate:** ${data.velocityMetrics.completionRate}%\n\n`;
    }

    md += `---\n*Generated by SKT Jira Summarizer | ${new Date().toLocaleDateString()}*\n`;
    return md;
  }

  function generatePdfHtml(data) {
    const ragColors = { green: "#00875a", amber: "#ff8b00", red: "#de350b" };
    const conf = (data.deliveryConfidence || "green").toLowerCase();

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sprint Summary - ${escapeHtml(data.epicName || "Executive Summary")}</title>
    <style>
      body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #172b4d; }
      h1 { font-size: 24px; border-bottom: 3px solid #0052cc; padding-bottom: 8px; }
      .rag { display: inline-block; padding: 4px 14px; border-radius: 16px; color: white; font-weight: 700; font-size: 14px; background: ${ragColors[conf] || "#666"}; }
      .meta { display: flex; gap: 20px; margin: 16px 0; padding: 12px; background: #f4f5f7; border-radius: 6px; }
      .meta-item { text-align: center; }
      .meta-label { font-size: 11px; color: #5e6c84; text-transform: uppercase; }
      .meta-value { font-size: 20px; font-weight: 700; }
      .summary { padding: 14px; background: #fff; border: 1px solid #dfe1e6; border-radius: 6px; margin: 16px 0; line-height: 1.6; }
      h2 { font-size: 16px; color: #0052cc; margin-top: 24px; }
      ul { padding-left: 20px; }
      li { margin: 6px 0; line-height: 1.4; }
      .rec { padding: 12px; background: #deebff; border-radius: 6px; border-left: 4px solid #0052cc; margin: 16px 0; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; }
      th, td { padding: 8px 12px; border: 1px solid #dfe1e6; text-align: left; font-size: 13px; }
      th { background: #f4f5f7; font-weight: 600; }
      .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #dfe1e6; font-size: 11px; color: #7a869a; }
      @media print { body { padding: 20px; } }
    </style></head><body>`;

    html += `<h1>${escapeHtml(data.epicName || "Executive Summary")} <span class="rag">${data.deliveryConfidence}</span></h1>`;

    html += `<div class="meta">
      <div class="meta-item"><div class="meta-label">Progress</div><div class="meta-value">${data.overallProgress}%</div></div>`;

    if (data.velocityMetrics) {
      html += `<div class="meta-item"><div class="meta-label">Velocity</div><div class="meta-value">${data.velocityMetrics.completedStoryPoints}/${data.velocityMetrics.totalStoryPoints} SP</div></div>`;
    }
    if (data.sprintHealth) {
      html += `<div class="meta-item"><div class="meta-label">Scope</div><div class="meta-value">${data.sprintHealth.scope}</div></div>`;
      html += `<div class="meta-item"><div class="meta-label">Morale</div><div class="meta-value">${data.sprintHealth.teamMorale}</div></div>`;
    }
    html += `</div>`;

    if (data.confidenceReason) html += `<p><em>${escapeHtml(data.confidenceReason)}</em></p>`;
    html += `<div class="summary">${escapeHtml(data.summary)}</div>`;

    if (data.keyBlockers && data.keyBlockers.length) {
      html += `<h2>Key Blockers</h2><ul>`;
      data.keyBlockers.forEach(b => { html += `<li>${escapeHtml(b)}</li>`; });
      html += `</ul>`;
    }
    if (data.risks && data.risks.length) {
      html += `<h2>Risks</h2><ul>`;
      data.risks.forEach(r => { html += `<li>${escapeHtml(r)}</li>`; });
      html += `</ul>`;
    }
    if (data.highlights && data.highlights.length) {
      html += `<h2>Highlights</h2><ul>`;
      data.highlights.forEach(h => { html += `<li>${escapeHtml(h)}</li>`; });
      html += `</ul>`;
    }
    if (data.recommendation) {
      html += `<div class="rec"><strong>Recommendation:</strong> ${escapeHtml(data.recommendation)}</div>`;
    }

    if (data.teamWorkload && data.teamWorkload.length) {
      html += `<h2>Team Workload</h2><table><tr><th>Assignee</th><th>Tasks</th><th>Done</th><th>In Progress</th><th>Blocked</th><th>SP</th><th>Status</th></tr>`;
      data.teamWorkload.forEach(m => {
        html += `<tr><td>${escapeHtml(m.assignee)}</td><td>${m.totalTasks}</td><td>${m.completed}</td><td>${m.inProgress}</td><td>${m.blocked}</td><td>${m.storyPoints || 0}</td><td>${m.workloadStatus}</td></tr>`;
      });
      html += `</table>`;
    }

    html += `<div class="footer">Generated by SKT Jira Summarizer v2.0.0 | ${new Date().toLocaleDateString()} | By Sujit Kumar Thakur</div>`;
    html += `</body></html>`;
    return html;
  }

  // ─── Utilities ────────────────────────────────────────────
  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function showToast(msg) {
    const toast = document.createElement("div");
    toast.className = "copied-toast";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
  }
});
