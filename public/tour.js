/**
 * tour.js — Spotlight onboarding tour engine
 *
 * Dùng:
 *   Tour.start(steps, tourKey)
 *
 * steps: Array<{
 *   target:   string   — CSS selector của element cần highlight (hoặc null cho modal toàn màn hình)
 *   title:    string   — Tiêu đề bước
 *   content:  string   — Mô tả HTML
 *   position: 'top'|'bottom'|'left'|'right'|'center'  — Vị trí popup (mặc định 'bottom')
 *   padding:  number   — Padding thêm quanh spotlight (mặc định 12)
 * }>
 *
 * tourKey: string — key lưu vào localStorage, tour sẽ không hiện lại nếu đã xem
 *
 * Có thể reset tất cả tour bằng: Tour.resetAll()
 */

const Tour = (() => {
  // ─── State ────────────────────────────────────────────────────────────────
  let steps = [];
  let currentStep = 0;
  let tourKey = '';
  let overlay = null;
  let spotlight = null;
  let popup = null;
  let skipBtn = null;
  let nextBtn = null;
  let stepIndicator = null;
  let resizeObserver = null;
  let animFrame = null;
  let _onFinish = null;

  // ─── DOM Helpers ──────────────────────────────────────────────────────────
  function $(sel) { return document.querySelector(sel); }

  function buildDOM() {
    // Xoá nếu đã tồn tại
    document.getElementById('tour-root')?.remove();

    const root = document.createElement('div');
    root.id = 'tour-root';
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Hướng dẫn sử dụng');

    // Lớp phủ tối — dùng SVG clipPath để "khoét lỗ" spotlight
    root.innerHTML = `
      <div id="tour-overlay">
        <svg id="tour-svg" aria-hidden="true">
          <defs>
            <mask id="tour-mask">
              <rect id="tour-mask-bg" fill="white"/>
              <rect id="tour-mask-hole" rx="10" fill="black"/>
            </mask>
          </defs>
          <rect id="tour-overlay-rect" mask="url(#tour-mask)"/>
        </svg>

        <div id="tour-highlight-border"></div>

        <div id="tour-popup" role="document">
          <div id="tour-popup-header">
            <span id="tour-step-indicator"></span>
            <button id="tour-skip-btn" type="button" aria-label="Bỏ qua hướng dẫn">Bỏ qua</button>
          </div>
          <h3 id="tour-title"></h3>
          <div id="tour-content"></div>
          <div id="tour-popup-footer">
            <div id="tour-dots"></div>
            <button id="tour-next-btn" type="button">Tiếp theo</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    overlay       = document.getElementById('tour-overlay');
    popup         = document.getElementById('tour-popup');
    skipBtn       = document.getElementById('tour-skip-btn');
    nextBtn       = document.getElementById('tour-next-btn');
    stepIndicator = document.getElementById('tour-step-indicator');

    skipBtn.addEventListener('click', finish);
    nextBtn.addEventListener('click', advance);
    document.addEventListener('keydown', onKey);
  }

  // ─── Spotlight geometry ───────────────────────────────────────────────────
  function getRect(target, padding) {
    if (!target) return null;
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const p = padding ?? 12;
    return {
      x: r.left - p,
      y: r.top + window.scrollY - p,
      w: r.width + p * 2,
      h: r.height + p * 2,
      screenY: r.top - p,   // relative to viewport (for popup placement)
      screenBottom: r.bottom + p,
      screenLeft: r.left - p,
      screenRight: r.right + p,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2
    };
  }

  function applySpotlight(rect) {
    const W = window.innerWidth;
    const H = window.innerHeight;

    const svg   = document.getElementById('tour-svg');
    const bg    = document.getElementById('tour-mask-bg');
    const hole  = document.getElementById('tour-mask-hole');
    const orect = document.getElementById('tour-overlay-rect');
    const border = document.getElementById('tour-highlight-border');

    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    bg.setAttribute('width', W);
    bg.setAttribute('height', H);
    orect.setAttribute('width', W);
    orect.setAttribute('height', H);

    if (!rect) {
      // Không có target → ẩn spotlight, overlay phủ toàn bộ
      hole.setAttribute('width', 0);
      hole.setAttribute('height', 0);
      border.style.display = 'none';
      return;
    }

    const viewY = rect.y - window.scrollY;

    hole.setAttribute('x', rect.x);
    hole.setAttribute('y', viewY);
    hole.setAttribute('width', rect.w);
    hole.setAttribute('height', rect.h);

    border.style.display  = 'block';
    border.style.left     = rect.x + 'px';
    border.style.top      = viewY + 'px';
    border.style.width    = rect.w + 'px';
    border.style.height   = rect.h + 'px';
  }

  // ─── Popup positioning ────────────────────────────────────────────────────
  function positionPopup(rect, position) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const POPUP_W = Math.min(360, W - 32);
    const GAP = 16;

    popup.style.width = POPUP_W + 'px';

    // Reset
    popup.style.left = '';
    popup.style.right = '';
    popup.style.top = '';
    popup.style.bottom = '';
    popup.style.transform = '';

    if (!rect || position === 'center') {
      popup.style.left = '50%';
      popup.style.top  = '50%';
      popup.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const ph = popup.offsetHeight || 200;

    // Tính toán vị trí
    let left, top;

    const pos = position || autoPosition(rect, W, H, ph, POPUP_W);

    if (pos === 'bottom') {
      top  = rect.screenBottom + GAP;
      left = rect.cx - POPUP_W / 2;
    } else if (pos === 'top') {
      top  = rect.screenY - ph - GAP;
      left = rect.cx - POPUP_W / 2;
    } else if (pos === 'left') {
      top  = rect.cy - ph / 2;
      left = rect.screenLeft - POPUP_W - GAP;
    } else if (pos === 'right') {
      top  = rect.cy - ph / 2;
      left = rect.screenRight + GAP;
    } else {
      top  = rect.screenBottom + GAP;
      left = rect.cx - POPUP_W / 2;
    }

    // Clamp để không ra ngoài màn hình
    left = Math.max(12, Math.min(left, W - POPUP_W - 12));
    top  = Math.max(12, Math.min(top, H - ph - 12));

    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';
  }

  function autoPosition(rect, W, H, ph, pw) {
    const spaceBottom = H - rect.screenBottom;
    const spaceTop    = rect.screenY;
    const spaceRight  = W - rect.screenRight;
    const spaceLeft   = rect.screenLeft;

    if (spaceBottom >= ph + 32) return 'bottom';
    if (spaceTop    >= ph + 32) return 'top';
    if (spaceRight  >= pw + 32) return 'right';
    if (spaceLeft   >= pw + 32) return 'left';
    return 'bottom';
  }

  // ─── Render step ──────────────────────────────────────────────────────────
  function renderStep(index) {
    const step = steps[index];
    const padding = step.padding ?? 12;

    // Chạy hook before nếu có (có thể là async)
    const beforeResult = step.before ? step.before() : undefined;
    const waitMs = (beforeResult instanceof Promise ? 320 : 0) + (step.target ? 200 : 0);

    // Scroll target into view if needed
    if (step.target) {
      const el = $(step.target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    }

    // Delay để: (1) before hook xử lý xong, (2) scroll hoàn thành
    setTimeout(() => {
      const rect = getRect(step.target, padding);

      applySpotlight(rect);
      positionPopup(rect, step.position);

      document.getElementById('tour-title').textContent = step.title || '';
      document.getElementById('tour-content').innerHTML = step.content || '';

      stepIndicator.textContent = `${index + 1} / ${steps.length}`;

      nextBtn.textContent = index === steps.length - 1 ? 'Bắt đầu!' : 'Tiếp theo';

      // Dots
      const dots = document.getElementById('tour-dots');
      dots.innerHTML = '';
      steps.forEach((_, i) => {
        const d = document.createElement('span');
        d.className = 'tour-dot' + (i === index ? ' active' : '');
        d.setAttribute('aria-hidden', 'true');
        dots.appendChild(d);
      });

      // Focus trap
      nextBtn.focus();
    }, waitMs);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  function advance() {
    if (currentStep < steps.length - 1) {
      currentStep++;
      renderStep(currentStep);
    } else {
      finish();
    }
  }

  function finish() {
    if (tourKey) {
      localStorage.setItem('tour_done_' + tourKey, '1');
    }
    // Chạy onFinish callback nếu có (dùng để cleanup trạng thái mô phỏng)
    if (typeof _onFinish === 'function') {
      try { _onFinish(); } catch (e) { /* ignore */ }
      _onFinish = null;
    }
    destroy();
  }

  function onKey(e) {
    if (e.key === 'Escape') { finish(); }
    if (e.key === 'ArrowRight' || e.key === 'Enter' && document.activeElement === nextBtn) { /* handled by click */ }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  function destroy() {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    document.getElementById('tour-root')?.remove();
    overlay = null; popup = null;
  }

  // ─── Resize handler ───────────────────────────────────────────────────────
  function onResize() {
    if (!popup) return;
    const step = steps[currentStep];
    const rect = getRect(step?.target, step?.padding ?? 12);
    applySpotlight(rect);
    positionPopup(rect, step?.position);
  }

  // ─── Public API ──────────────────────────────────────────────────────────
  function start(tourSteps, key, { onFinish } = {}) {
    if (!tourSteps || !tourSteps.length) return;
    if (key && localStorage.getItem('tour_done_' + key)) return;

    steps = tourSteps;
    currentStep = 0;
    tourKey = key || '';
    _onFinish = onFinish || null;

    buildDOM();
    renderStep(0);

    // Re-layout on resize
    window.addEventListener('resize', onResize);
  }

  function resetAll() {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('tour_done_'))
      .forEach((k) => localStorage.removeItem(k));
    console.log('Tour: đã reset tất cả trạng thái.');
  }

  function reset(key) {
    localStorage.removeItem('tour_done_' + key);
  }

  return { start, finish, reset, resetAll };
})();
