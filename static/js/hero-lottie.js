(function () {
  const container = document.getElementById('hero-lottie');
  if (!container) return;

  // ------------------------------------------------------------------
  // Put your downloaded Lottie JSON at: static/lottie/hero-travel.json
  //
  // Where to get one (free, matches the "polished 3D toy" style):
  //   1. Go to lottiefiles.com
  //   2. Search "3d travel", "3d airplane", or "isometric travel"
  //   3. Good matches: "Small 3d airplane animation" by MD Abdur Rahim,
  //      or anything tagged "3d icon" / "3d animation" in the travel/flight category
  //   4. Open the animation -> Download -> "Lottie JSON"
  //   5. Rename the downloaded file to hero-travel.json
  //   6. Put it at static/lottie/hero-travel.json in this project
  // ------------------------------------------------------------------
  const LOTTIE_PATH = '/static/lottie/hero-travel.json';
  const PLAYBACK_SPEED = 0.45; // slower, more premium feel — tweak between 0.3–0.7 to taste

  fetch(LOTTIE_PATH, { method: 'HEAD' })
    .then((res) => {
      if (!res.ok) throw new Error('not found');
      const anim = window.lottie.loadAnimation({
        container,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: LOTTIE_PATH,
      });
      anim.setSpeed(PLAYBACK_SPEED);
      window.__heroLottieAnim = anim;
    })
    .catch(() => {
      // No illustration placed yet — show a soft placeholder instead of breaking the layout.
      container.classList.add('hero-lottie-placeholder');
      container.innerHTML = `
        <div class="placeholder-inner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13L4 15v-2l6-4V4.5C10 3.7 10.7 3 11.5 3s1.5.7 1.5 1.5V9l6 4v2l-6-2-1 4 2 1.5V20l-2.5-1-2.5 1v-1.5L11 17l-1-4z"/></svg>
          <p>Add your Lottie illustration at<br><code>static/lottie/hero-travel.json</code></p>
        </div>`;
    });

  // Subtle parallax tilt following the cursor — applied to the whole composition
  const tiltTarget = document.querySelector('.hero-visual-stage') || container;
  let targetX = 0, targetY = 0, curX = 0, curY = 0;
  window.addEventListener('mousemove', (e) => {
    const rect = tiltTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    targetX = ((e.clientX - cx) / rect.width) * 8;
    targetY = ((e.clientY - cy) / rect.height) * -8;
  });
  function tick() {
    curX += (targetX - curX) * 0.06;
    curY += (targetY - curY) * 0.06;
    tiltTarget.style.transform = `rotateY(${curX}deg) rotateX(${curY}deg)`;
    requestAnimationFrame(tick);
  }
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) tick();
})();