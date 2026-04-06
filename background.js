const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    handleSummarize(request.data, request.model).then(sendResponse);
    return true;
  }
  if (request.action === "getApiKey") {
    chrome.storage.sync.get(["openRouterApiKey"], (result) => {
      sendResponse({ apiKey: result.openRouterApiKey || "" });
    });
    return true;
  }
  if (request.action === "saveApiKey") {
    chrome.storage.sync.set({ openRouterApiKey: request.apiKey }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (request.action === "saveHistory") {
    saveToHistory(request.entry).then(sendResponse);
    return true;
  }
  if (request.action === "getHistory") {
    getHistory().then(sendResponse);
    return true;
  }
  if (request.action === "clearHistory") {
    chrome.storage.local.set({ summaryHistory: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (request.action === "deleteHistoryItem") {
    deleteHistoryItem(request.id).then(sendResponse);
    return true;
  }
});

async function handleSummarize(jiraData, model) {
  try {
    const { openRouterApiKey } = await chrome.storage.sync.get(["openRouterApiKey"]);
    const apiKey = openRouterApiKey;

    if (!apiKey) {
      throw new Error("No API key configured. Please add your OpenRouter API key in Settings.");
    }

    const prompt = buildPrompt(jiraData);

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "chrome-extension://jira-summarizer",
        "X-Title": "SKT Jira Summarizer"
      },
      body: JSON.stringify({
        model: model || "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "system",
            content: `You are an expert project management analyst who creates CXO-level executive summaries from Jira data.
You must respond ONLY with valid JSON matching this exact schema:
{
  "epicName": "string",
  "overallProgress": number (0-100),
  "deliveryConfidence": "Green" | "Amber" | "Red",
  "confidenceReason": "string (1 sentence why this RAG status)",
  "summary": "string (2-3 sentence executive summary)",
  "keyBlockers": ["string array of blockers"],
  "risks": ["string array of risks"],
  "highlights": ["string array of key wins/progress"],
  "recommendation": "string (1 sentence action item for leadership)",
  "teamWorkload": [
    {
      "assignee": "string (person name)",
      "totalTasks": number,
      "completed": number,
      "inProgress": number,
      "blocked": number,
      "storyPoints": number (total assigned story points, 0 if unknown),
      "workloadStatus": "Balanced" | "Overloaded" | "Underutilized"
    }
  ],
  "velocityMetrics": {
    "totalStoryPoints": number (total SP in sprint, 0 if unknown),
    "completedStoryPoints": number (completed SP, 0 if unknown),
    "remainingStoryPoints": number (remaining SP, 0 if unknown),
    "completionRate": number (0-100 percentage)
  },
  "sprintHealth": {
    "scope": "Stable" | "Creeping" | "Reduced",
    "teamMorale": "High" | "Medium" | "Low",
    "scopeNote": "string (1 sentence about scope changes if any)"
  }
}
Be precise. Base confidence on data, not optimism. If blockers exist, confidence cannot be Green.
For teamWorkload, analyze each unique assignee's task distribution.
For velocityMetrics, calculate from story points data if available.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 2500
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`API error ${response.status}: ${errBody}`);
    }

    const result = await response.json();
    const content = result.choices[0].message.content;

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const parsed = JSON.parse(jsonMatch[1].trim());

    return { success: true, data: parsed };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function buildPrompt(jiraData) {
  let prompt = `Analyze this Jira data and produce an executive summary:\n\n`;

  if (jiraData.boardName) {
    prompt += `**Board/Project:** ${jiraData.boardName}\n`;
  }
  if (jiraData.sprintName) {
    prompt += `**Sprint:** ${jiraData.sprintName}\n`;
  }

  if (jiraData.issues && jiraData.issues.length > 0) {
    prompt += `\n**Issues (${jiraData.issues.length} total):**\n`;

    const statusCounts = {};
    const typeCounts = {};
    const assigneeCounts = {};
    const blockers = [];
    const flagged = [];
    let totalSP = 0;
    let completedSP = 0;

    for (const issue of jiraData.issues) {
      statusCounts[issue.status] = (statusCounts[issue.status] || 0) + 1;
      typeCounts[issue.type] = (typeCounts[issue.type] || 0) + 1;

      // Track assignee workload
      const assignee = issue.assignee || "Unassigned";
      if (!assigneeCounts[assignee]) {
        assigneeCounts[assignee] = { total: 0, statuses: {}, storyPoints: 0 };
      }
      assigneeCounts[assignee].total++;
      assigneeCounts[assignee].statuses[issue.status] = (assigneeCounts[assignee].statuses[issue.status] || 0) + 1;
      if (issue.storyPoints) {
        assigneeCounts[assignee].storyPoints += issue.storyPoints;
        totalSP += issue.storyPoints;
        const doneStatuses = ["done", "closed", "resolved", "complete", "completed"];
        if (doneStatuses.some(s => issue.status.toLowerCase().includes(s))) {
          completedSP += issue.storyPoints;
        }
      }

      if (issue.priority === "Blocker" || issue.priority === "Highest") {
        blockers.push(issue);
      }
      if (issue.flagged) {
        flagged.push(issue);
      }
    }

    prompt += `\n**Status Breakdown:**\n`;
    for (const [status, count] of Object.entries(statusCounts)) {
      prompt += `- ${status}: ${count}\n`;
    }

    prompt += `\n**Type Breakdown:**\n`;
    for (const [type, count] of Object.entries(typeCounts)) {
      prompt += `- ${type}: ${count}\n`;
    }

    // Assignee workload section
    prompt += `\n**Assignee Workload:**\n`;
    for (const [assignee, data] of Object.entries(assigneeCounts)) {
      prompt += `- ${assignee}: ${data.total} tasks (SP: ${data.storyPoints}) — `;
      prompt += Object.entries(data.statuses).map(([s, c]) => `${s}: ${c}`).join(", ");
      prompt += `\n`;
    }

    // Velocity data
    if (totalSP > 0) {
      prompt += `\n**Story Points:** Total: ${totalSP}, Completed: ${completedSP}, Remaining: ${totalSP - completedSP}\n`;
    }

    if (blockers.length > 0) {
      prompt += `\n**High Priority / Blockers:**\n`;
      for (const b of blockers) {
        prompt += `- [${b.key}] ${b.summary} (${b.status}, ${b.priority}, Assignee: ${b.assignee || "Unassigned"})\n`;
      }
    }

    if (flagged.length > 0) {
      prompt += `\n**Flagged Issues:**\n`;
      for (const f of flagged) {
        prompt += `- [${f.key}] ${f.summary} (${f.status})\n`;
      }
    }

    prompt += `\n**All Issues Detail:**\n`;
    for (const issue of jiraData.issues) {
      prompt += `- [${issue.key}] ${issue.summary} | Type: ${issue.type} | Status: ${issue.status} | Priority: ${issue.priority} | Assignee: ${issue.assignee || "Unassigned"}`;
      if (issue.epicName) prompt += ` | Epic: ${issue.epicName}`;
      if (issue.storyPoints) prompt += ` | SP: ${issue.storyPoints}`;
      prompt += `\n`;
    }
  }

  if (jiraData.epics && jiraData.epics.length > 0) {
    prompt += `\n**Epics:**\n`;
    for (const epic of jiraData.epics) {
      prompt += `- ${epic.name}: ${epic.done || 0} done / ${epic.total || 0} total issues\n`;
    }
  }

  return prompt;
}

// History management
async function saveToHistory(entry) {
  try {
    const { summaryHistory = [] } = await chrome.storage.local.get(["summaryHistory"]);
    const historyEntry = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      boardName: entry.boardName || "Unknown",
      sprintName: entry.sprintName || "",
      issueCount: entry.issueCount || 0,
      summary: entry.summary,
      velocityMetrics: entry.velocityMetrics || null
    };

    summaryHistory.unshift(historyEntry);

    // Keep only last 50 entries
    if (summaryHistory.length > 50) {
      summaryHistory.length = 50;
    }

    await chrome.storage.local.set({ summaryHistory });
    return { success: true, id: historyEntry.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getHistory() {
  try {
    const { summaryHistory = [] } = await chrome.storage.local.get(["summaryHistory"]);
    return { success: true, data: summaryHistory };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function deleteHistoryItem(id) {
  try {
    const { summaryHistory = [] } = await chrome.storage.local.get(["summaryHistory"]);
    const filtered = summaryHistory.filter(item => item.id !== id);
    await chrome.storage.local.set({ summaryHistory: filtered });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
