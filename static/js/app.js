(function () {
  const form = document.getElementById('trip-form');
  const queryEl = document.getElementById('query');
  const submitBtn = document.getElementById('submit-btn');
  const pipeline = document.getElementById('pipeline');
  const results = document.getElementById('results');
  const errorBox = document.getElementById('error-box');
  const errorMsg = document.getElementById('error-msg');
  const threadHint = document.getElementById('thread-hint');

  const guardrailCard = document.getElementById('card-guardrail');
  const guardrailTag = document.getElementById('guardrail-tag');
  const guardrailTitle = document.getElementById('guardrail-title');
  const guardrailIcon = document.getElementById('guardrail-icon');
  const guardrailContent = document.getElementById('guardrail-content');

  const approvalCard = document.getElementById('card-approval');
  const approveBtn = document.getElementById('approve-btn');
  const reviseBtn = document.getElementById('revise-btn');
  const feedbackInput = document.getElementById('feedback-input');

  const STORAGE_KEY = 'agenttrip_thread_id';
  let threadId = localStorage.getItem(STORAGE_KEY) || null;
  updateThreadHint();

  function updateThreadHint() {
    threadHint.textContent = threadId ? `continuing thread ${threadId.slice(-8)}` : 'new session';
  }

  const steps = ['flight', 'hotel', 'weather', 'budget', 'itinerary', 'trip'];

  function resetPipeline() {
    pipeline.hidden = false;
    document.querySelectorAll('.step').forEach((s) => s.classList.remove('active', 'done'));
    document.querySelectorAll('.link').forEach((l) => l.classList.remove('done'));
  }

  function markStep(name, state) {
    const el = document.querySelector(`.step[data-step="${name}"]`);
    if (!el) return;
    el.classList.remove('active', 'done');
    el.classList.add(state);
  }

  function markLinkDone(index) {
    const links = document.querySelectorAll('.link');
    if (links[index]) links[index].classList.add('done');
  }

  async function animatePipelineWhilePending(promise) {
    resetPipeline();
    const stepGap = 500;
    let cancelled = false;

    steps.forEach((step, i) => {
      setTimeout(() => {
        if (cancelled) return;
        markStep(step, 'active');
        if (i > 0) markStep(steps[i - 1], 'done');
        if (i > 0) markLinkDone(i - 1);
      }, i * stepGap);
    });

    const result = await promise;
    cancelled = true;
    steps.forEach((s, i) => {
      markStep(s, 'done');
      markLinkDone(i);
    });
    return result;
  }

  function showError(message) {
    errorBox.hidden = false;
    errorMsg.textContent = message;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() {
    errorBox.hidden = true;
    errorMsg.textContent = '';
  }

  function renderMarkdown(text) {
    if (!text) return '';
    try {
      const raw = window.marked ? window.marked.parse(String(text)) : String(text).replace(/\n/g, '<br>');
      return window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
    } catch (e) {
      return String(text).replace(/</g, '&lt;');
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  
  function renderAsJson(elementId, data) {
    const el = document.getElementById(elementId);
    const isEmpty =
      data == null ||
      (Array.isArray(data) && data.length === 0) ||
      (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) ||
      (typeof data === 'string' && data.trim() === '');

    if (isEmpty) {
      el.innerHTML = '<p class="muted">No data returned.</p>';
      return;
    }

    let text;
    try {
      text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    } catch (e) {
      text = String(data);
    }

    el.innerHTML = `<pre class="weather-raw">${escapeHtml(text)}</pre>`;
  }
  function unwrapMcpContent(value) {
  if (Array.isArray(value) && value.length && typeof value[0]?.text === 'string') {
    try {
      return JSON.parse(value[0].text);
    } catch (e) {
      return value[0].text;
    }
  }
  return value;
}
  function renderHotelCardSimple(hotelResults) {
  const el = document.getElementById('hotel-content');
  const parsed = unwrapMcpContent(hotelResults);

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.results) || parsed.results.length === 0) {
    renderAsJson('hotel-content', hotelResults); // fallback to raw JSON if shape is unexpected
    return;
  }

  const items = parsed.results
    .slice(0, 6)
    .map((r) => {
      const title = escapeHtml(r.title || 'Untitled result');
      const url = r.url ? escapeHtml(r.url) : '';
      const snippet = r.content ? escapeHtml(String(r.content).slice(0, 200)) + '…' : '';
      const titleHtml = url
        ? `<a href="${url}" target="_blank" rel="noopener"><strong>${title}</strong></a>`
        : `<strong>${title}</strong>`;
      return `<p>${titleHtml}<br><span class="muted">${snippet}</span></p>`;
    })
    .join('');

  el.innerHTML = items;
}

function renderWeatherCardSimple(weatherResults) {
  const el = document.getElementById('weather-content');
  if (!weatherResults) {
    el.innerHTML = '<p class="muted">No weather data returned.</p>';
    return;
  }

  const current = unwrapMcpContent(weatherResults.current_weather);
  const forecast = unwrapMcpContent(weatherResults.forecast);

  let html = '';

  if (current && typeof current === 'object') {
    html += `<p><strong>${escapeHtml(current.city || '')}</strong> — ${Math.round(current.temperature_c)}°C, ${escapeHtml(current.condition || '')}</p>`;
  }

  if (forecast && Array.isArray(forecast.forecast)) {
    html += forecast.forecast
      .slice(0, 5)
      .map((f) => `<p>${escapeHtml(f.datetime)}: ${Math.round(f.temperature_c)}°C, ${escapeHtml(f.condition)}</p>`)
      .join('');
  }

  el.innerHTML = html || renderAsJson('weather-content', weatherResults); // fallback
}


  const AGENT_LABELS = {
    flight_agent: 'Flight Agent',
    hotel_agent: 'Hotel Agent',
    weather_agent: 'Weather Agent',
    budget_agent: 'Budget Agent',
    itinerary_agent: 'Itinerary Agent',
  };

  // Guardrail verdict card: green check + agents run, or red cross + reason.
  function renderGuardrailCard(data) {
    guardrailCard.hidden = false;
    const blocked = data.guardrail_allowed === false;

    if (blocked) {
      guardrailCard.classList.add('blocked');
      guardrailCard.classList.remove('approved');
      guardrailTag.textContent = 'BLOCKED';
      guardrailTitle.textContent = 'Request not approved';
      guardrailIcon.innerHTML = '&#10060;'; // ❌
      guardrailContent.innerHTML = `<p>${escapeHtml(data.guardrail_reason || 'This request falls outside travel planning.')}</p>`;
      return;
    }

    guardrailCard.classList.add('approved');
    guardrailCard.classList.remove('blocked');
    guardrailTag.textContent = 'APPROVED';
    guardrailTitle.textContent = 'Request approved';
    guardrailIcon.innerHTML = '&#9989;'; // ✅

    const agents = data.selected_agents || [];
    const chips = agents
      .map((a) => `<span class="agent-chip">${escapeHtml(AGENT_LABELS[a] || a)}</span>`)
      .join('');
    let html = `<div class="agent-chip-row">${chips || '<span class="muted">No agents selected</span>'}</div>`;
    if (data.supervisor_reasoning) {
      html += `<p class="muted supervisor-note">${escapeHtml(data.supervisor_reasoning)}</p>`;
    }
    guardrailContent.innerHTML = html;
  }

  let lastData = null;

  function buildDownloadText(data) {
    const parts = [
      `# AgentTrip — Travel Plan`,
      `_Generated ${new Date().toLocaleString()} · thread ${data.thread_id || 'n/a'}_`,
      '',
      data.answer || data.itinerary || '',
    ];
    return parts.join('\n');
  }

  
  function downloadPlan(data) {
  const text = buildDownloadText(data);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const margin = 40;
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
  const lineHeight = 14;
  let y = margin;

  const lines = doc.splitTextToSize(text, maxWidth);
  lines.forEach((line) => {
    if (y > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  });

  doc.save(`agenttrip-plan-${(data.thread_id || 'trip').slice(-8)}.pdf`);
}

  function renderResults(data) {
    lastData = data;
    renderGuardrailCard(data);

    const blocked = data.guardrail_allowed === false;

    document.getElementById('card-flight').hidden = blocked;
    document.getElementById('card-hotel').hidden = blocked;
    document.getElementById('card-weather').hidden = blocked;
    document.getElementById('card-budget').hidden = blocked;

    if (blocked) {
      approvalCard.hidden = true;
      document.getElementById('card-final').hidden = true;
      results.hidden = false;
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    document.getElementById('flight-content').innerHTML = renderMarkdown(data.flight_results);
    renderHotelCardSimple(data.hotel_results);
    renderWeatherCardSimple(data.weather_results);
    document.getElementById('budget-content').innerHTML = renderMarkdown(data.budget_results);
    

    if (data.require_approval) {
      // Draft itinerary awaiting human sign-off.
      approvalCard.hidden = false;
      document.getElementById('approval-content').innerHTML = renderMarkdown(data.answer || data.itinerary);
      document.getElementById('card-final').hidden = true;
      approvalCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Finalized — show the plan and let them download.
      approvalCard.hidden = true;
      document.getElementById('card-final').hidden = false;
      document.getElementById('final-content').innerHTML = renderMarkdown(data.answer);
      document.getElementById('llm-calls').textContent = `llm_calls: ${data.llm_calls ?? 0}`;
      document.getElementById('thread-id').textContent = `thread: ${data.thread_id || '—'}`;
    }

    results.hidden = false;
    if (!data.require_approval) {
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  document.getElementById('download-btn').addEventListener('click', () => {
    if (!lastData) return;
    downloadPlan(lastData);
  });

  async function submitTrip(query) {
    hideError();
    results.hidden = true;
    guardrailCard.hidden = true;
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    pipeline.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const fetchPromise = fetch('/api/trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: query, thread_id: threadId }),
    }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        throw new Error(body.error || `Request failed with status ${res.status}`);
      }
      return body;
    });

    try {
      const data = await animatePipelineWhilePending(fetchPromise);
      threadId = data.thread_id || threadId;
      if (threadId) localStorage.setItem(STORAGE_KEY, threadId);
      updateThreadHint();
      renderResults(data);
    } catch (err) {
      pipeline.hidden = true;
      showError(err.message || 'The trip agent could not complete this request.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
    }
  }

  async function submitResume(approved) {
    if (!threadId) {
      showError('No active trip session to resume.');
      return;
    }
    const feedback = feedbackInput.value.trim();
    approveBtn.disabled = true;
    reviseBtn.disabled = true;

    try {
      const res = await fetch('/api/trip/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId, approved, feedback }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }
      feedbackInput.value = '';
      renderResults(data);
      if (!data.require_approval) {
        // Fully finalized after this round — jump to the plan.
        document.getElementById('card-final').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      showError(err.message || 'Could not process your response.');
    } finally {
      approveBtn.disabled = false;
      reviseBtn.disabled = false;
    }
  }

  approveBtn.addEventListener('click', () => submitResume(true));
  reviseBtn.addEventListener('click', () => submitResume(false));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = queryEl.value.trim();
    if (!query) return;
    await submitTrip(query);
  });

  document.getElementById('trip-form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
})();