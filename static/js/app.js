(function () {
  const form = document.getElementById('trip-form');
  const queryEl = document.getElementById('query');
  const submitBtn = document.getElementById('submit-btn');
  const pipeline = document.getElementById('pipeline');
  const results = document.getElementById('results');
  const errorBox = document.getElementById('error-box');
  const errorMsg = document.getElementById('error-msg');
  const threadHint = document.getElementById('thread-hint');

  const STORAGE_KEY = 'agenttrip_thread_id';
  let threadId = localStorage.getItem(STORAGE_KEY) || null;
  updateThreadHint();

  function updateThreadHint() {
    threadHint.textContent = threadId ? `continuing thread ${threadId.slice(-8)}` : 'new session';
  }

  const steps = ['flight', 'hotel', 'itinerary', 'trip'];

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

  // Fake a believable progression while the single backend call is in flight,
  // then snap everything to "done" the moment the real response arrives.
  async function animatePipelineWhilePending(promise) {
    resetPipeline();
    const delays = [0, 650, 1300, 2000];
    let cancelled = false;

    steps.forEach((step, i) => {
      setTimeout(() => {
        if (cancelled) return;
        markStep(step, 'active');
        if (i > 0) markStep(steps[i - 1], 'done');
        if (i > 0) markLinkDone(i - 1);
      }, delays[i]);
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
      const raw = window.marked ? window.marked.parse(text) : text.replace(/\n/g, '<br>');
      return window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
    } catch (e) {
      return text.replace(/</g, '&lt;');
    }
  }

  let lastData = null;

  function renderResults(data) {
    lastData = data;
    document.getElementById('final-content').innerHTML = renderMarkdown(data.answer);
    document.getElementById('llm-calls').textContent = `llm_calls: ${data.llm_calls ?? 0}`;
    document.getElementById('thread-id').textContent = `thread: ${data.thread_id || '—'}`;

    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.getElementById('download-btn').addEventListener('click', () => {
    if (!lastData) return;
    const parts = [
      `# AgentTrip — Travel Plan`,
      `_Generated ${new Date().toLocaleString()} · thread ${lastData.thread_id || 'n/a'}_`,
      '',
      lastData.answer || '',
    ];
    const blob = new Blob([parts.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agenttrip-plan-${(lastData.thread_id || 'trip').slice(-8)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = queryEl.value.trim();
    if (!query) return;

    hideError();
    results.hidden = true;
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    pipeline.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const fetchPromise = fetch('/api/trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: query, thread_id: threadId }),
    })
      .then(async (res) => {
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
  });

  document.getElementById('trip-form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
})();