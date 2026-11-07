/* =========================================================
   立冬 · 和你一起走到冬天
   雪花、点亮文字、雪地书写、拆信、一起淋雪
   ========================================================= */

(function () {
  'use strict';

  // 若脚本中途出错，宁可少一点动画，也不要留下空白
  window.addEventListener('error', () => {
    document.documentElement.classList.remove('js', 'reveal-ready');
  });

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const haptic = (pattern) => {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (_) { /* 忽略 */ }
  };

  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  /* ---------------------------------------------------------
     雪：远近三层 + 晶体 + 手指带风 + 点击爆开的雪
     --------------------------------------------------------- */

  const Snow = (() => {
    const canvas = $('#snow');
    if (!canvas) return { init() {}, burst() {}, storm() {}, addWind() {} };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { init() {}, burst() {}, storm() {}, addWind() {} };

    let W = 0;
    let H = 0;
    let dpr = 1;
    let flakes = [];
    let bursts = [];
    let baseCount = 60;
    let targetCount = 60;
    let running = false;
    let raf = 0;
    let last = 0;
    let wind = 0;
    let windTarget = 0;
    let storming = false;
    let dotSprite = null;
    let crystalSprite = null;
    let resizeTimer = 0;

    function makeDot() {
      const size = 48;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(.35, 'rgba(244,250,255,.82)');
      grad.addColorStop(1, 'rgba(240,248,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return c;
    }

    function makeCrystal() {
      const size = 64;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.translate(size / 2, size / 2);
      g.strokeStyle = 'rgba(240,248,255,.95)';
      g.lineCap = 'round';
      g.shadowColor = 'rgba(200,230,255,.9)';
      g.shadowBlur = 3;

      for (let i = 0; i < 6; i += 1) {
        g.save();
        g.rotate((i * Math.PI) / 3);
        g.lineWidth = 1.7;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -25);
        g.stroke();
        g.lineWidth = 1.15;
        g.beginPath();
        g.moveTo(0, -15);
        g.lineTo(5, -20);
        g.moveTo(0, -15);
        g.lineTo(-5, -20);
        g.stroke();
        g.beginPath();
        g.moveTo(0, -21);
        g.lineTo(3.4, -24.6);
        g.moveTo(0, -21);
        g.lineTo(-3.4, -24.6);
        g.stroke();
        g.restore();
      }

      g.beginPath();
      g.arc(0, 0, 1.7, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.fill();
      return c;
    }

    function makeFlake(initial) {
      const depth = Math.random();
      const r = depth < .62 ? rand(.6, 2.0) : rand(1.9, 3.8);
      return {
        x: rand(-40, W + 40),
        y: initial ? rand(-H * .15, H) : rand(-70, -8),
        r,
        vy: 15 + r * 11 + depth * 18,
        sway: rand(.35, 1.3),
        amp: rand(.08, .38),
        phase: rand(0, Math.PI * 2),
        depth,
        alpha: .18 + depth * .58,
        crystal: depth > .72 && Math.random() < .38,
        rot: rand(0, Math.PI * 2),
        vr: rand(-.35, .35),
      };
    }

    function countForViewport() {
      let n = Math.round((W * H) / 6000);
      n = clamp(n, 44, 150);
      if (reduceMotion) n = Math.round(n * .35);
      return n;
    }

    function resize() {
      dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      baseCount = countForViewport();
      targetCount = baseCount + (storming ? Math.round(baseCount * 1.5) : 0);
    }

    function drawFlake(f) {
      if (f.crystal) {
        const size = f.r * 4.3;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.globalAlpha = f.alpha;
        ctx.drawImage(crystalSprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        const size = f.r * 3.1;
        ctx.globalAlpha = f.alpha;
        ctx.drawImage(dotSprite, f.x - size / 2, f.y - size / 2, size, size);
      }
    }

    function frame(ts) {
      if (!running) return;
      raf = window.requestAnimationFrame(frame);

      const dt = clamp((ts - last) / 1000, .001, .05);
      last = ts;

      windTarget *= .955;
      wind += (windTarget - wind) * .055;

      while (flakes.length < targetCount) flakes.push(makeFlake(false));

      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < flakes.length; i += 1) {
        const f = flakes[i];
        f.y += f.vy * dt;
        f.x += (wind * .34 * (.35 + f.depth)
          + Math.sin(ts * .0007 * f.sway + f.phase) * f.amp) * dt * 60;
        f.rot += f.vr * dt;

        if (f.y > H + 26 || f.x < -90 || f.x > W + 90) {
          if (flakes.length > targetCount) {
            flakes.splice(i, 1);
            i -= 1;
            continue;
          }
          flakes[i] = makeFlake(false);
          continue;
        }
        drawFlake(f);
      }

      for (let i = 0; i < bursts.length; i += 1) {
        const p = bursts[i];
        p.age += dt;
        if (p.age >= p.life) {
          bursts.splice(i, 1);
          i -= 1;
          continue;
        }
        p.vy += 95 * dt;
        p.vx *= .986;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const alpha = 1 - p.age / p.life;
        const size = p.r * 4;
        ctx.globalAlpha = alpha * .85;
        ctx.drawImage(dotSprite, p.x - size / 2, p.y - size / 2, size, size);
      }

      ctx.globalAlpha = 1;
    }

    function init() {
      dotSprite = makeDot();
      crystalSprite = makeCrystal();
      resize();
      flakes = [];
      for (let i = 0; i < targetCount; i += 1) flakes.push(makeFlake(true));
      running = true;
      last = performance.now();
      raf = window.requestAnimationFrame(frame);

      window.addEventListener('resize', () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(resize, 180);
      }, { passive: true });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) last = performance.now();
      });
    }

    function burst(x, y, amount) {
      const n = amount || 12;
      for (let i = 0; i < n; i += 1) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(30, 170);
        bursts.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - rand(10, 55),
          r: rand(1.2, 3.2),
          age: 0,
          life: rand(.7, 1.5),
        });
      }
    }

    function storm(on) {
      storming = !!on;
      targetCount = baseCount + (storming ? Math.round(baseCount * 1.5) : 0);
      if (storming) {
        addWind(rand(-14, 14));
        for (let i = 0; i < 24; i += 1) {
          const f = makeFlake(false);
          f.y = rand(-H * .4, 0);
          flakes.push(f);
        }
      }
    }

    function addWind(dx) {
      windTarget = clamp(windTarget + dx, -22, 22);
    }

    return { init, burst, storm, addWind };
  })();

  /* ---------------------------------------------------------
     滚动：进度、视差、逐字点亮
     --------------------------------------------------------- */

  function setupScroll() {
    const bar = $('#progressBar');
    const heroInner = $('#heroInner');
    const lit = $('#litText');
    const litLines = lit ? $$('.lit-line', lit) : [];
    const litChars = [];
    let litOn = 0;
    let queued = false;

    if (lit) {
      litLines.forEach((line) => {
        const text = line.textContent;
        line.textContent = '';
        Array.from(text).forEach((ch) => {
          const span = document.createElement('span');
          span.className = 'c';
          span.textContent = ch;
          line.appendChild(span);
          litChars.push(span);
        });
      });
    }

    function updateLit() {
      if (!lit) return;
      const rect = lit.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = clamp((vh * .78 - rect.top) / (rect.height + vh * .3), 0, 1);
      const next = Math.floor(p * litChars.length * 1.02);
      if (next > litOn) {
        for (let i = litOn; i < next && i < litChars.length; i += 1) litChars[i].classList.add('on');
      } else if (next < litOn) {
        for (let i = next; i < litOn && i < litChars.length; i += 1) litChars[i].classList.remove('on');
      }
      litOn = next;
    }

    function update() {
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.width = (max > 0 ? clamp((y / max) * 100, 0, 100) : 0) + '%';

      if (!reduceMotion && heroInner) {
        const p = Math.min(y, window.innerHeight);
        heroInner.style.transform = 'translate3d(0,' + (p * .14).toFixed(2) + 'px,0)';
        heroInner.style.opacity = String(clamp(1 - p / (window.innerHeight * .72), 0, 1));
      }

      updateLit();
    }

    function request() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        update();
      });
    }

    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
    window.addEventListener('load', request);
    update();
  }

  /* ---------------------------------------------------------
     出现动画
     --------------------------------------------------------- */

  function setupReveals() {
    const items = $$('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('in'));
      return;
    }

    document.documentElement.classList.add('reveal-ready');

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { threshold: .14, rootMargin: '0px 0px -7% 0px' });

    items.forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------
     雪地写字
     --------------------------------------------------------- */

  function setupSnowpad() {
    const pad = $('#snowpad');
    const canvas = $('#writeCanvas');
    const hint = $('#snowpadHint');
    const clearBtn = $('#clearSnow');
    if (!pad || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let dpr = 1;
    let painting = false;
    let lastPoint = null;
    let hiddenHint = false;
    let resizeTimer = 0;

    function size() {
      const rect = pad.getBoundingClientRect();
      dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      W = rect.width;
      H = rect.height;

      // 换尺寸（比如手机地址栏收起）时，把已经写下的字一起搬过去
      const snapshot = document.createElement('canvas');
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      if (snapshot.width && snapshot.height) {
        snapshot.getContext('2d').drawImage(canvas, 0, 0);
      }

      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 不透明笔触 + 圆头，重叠处不会叠出珠子，雪痕是连续的一条
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.clearRect(0, 0, W, H);
      if (snapshot.width && snapshot.height && W && H) {
        ctx.drawImage(snapshot, 0, 0, W, H);
      }
    }

    function local(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function hideHint() {
      if (hiddenHint || !hint) return;
      hiddenHint = true;
      hint.classList.add('hide');
    }

    function ink(from, to) {
      if (!ctx) return;
      const speed = Math.min(1, Math.hypot(to.x - from.x, to.y - from.y) / 26);
      const width = 16 - speed * 5;

      ctx.globalCompositeOperation = 'source-over';

      // 一条实心的、偏冷的灰蓝，像手指按下去的一道雪痕
      ctx.strokeStyle = '#8fa9c3';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    function dotAt(p) {
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
      grad.addColorStop(0, 'rgba(143,169,195,.95)');
      grad.addColorStop(1, 'rgba(143,169,195,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    function start(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      painting = true;
      lastPoint = local(event);
      hideHint();
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* 忽略 */ }
      dotAt(lastPoint);
      if (event.cancelable) event.preventDefault();
    }

    function move(event) {
      if (!painting || !lastPoint) return;
      const point = local(event);
      const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
      if (distance < 1.1) return;
      ink(lastPoint, point);
      lastPoint = point;
      if (event.cancelable) event.preventDefault();
    }

    function end() {
      painting = false;
      lastPoint = null;
    }

    canvas.addEventListener('pointerdown', start, { passive: false });
    canvas.addEventListener('pointermove', move, { passive: false });
    canvas.addEventListener('pointerup', end, { passive: true });
    canvas.addEventListener('pointercancel', end, { passive: true });
    canvas.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && painting) end();
    }, { passive: true });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        ctx.clearRect(0, 0, W, H);
        hiddenHint = false;
        if (hint) hint.classList.remove('hide');
        toast('雪又平了，重新写吧');
        haptic(6);
      });
    }

    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(size, 160);
      });
      ro.observe(pad);
    } else {
      window.addEventListener('resize', size, { passive: true });
    }

    size();
  }

  /* ---------------------------------------------------------
     信
     --------------------------------------------------------- */

  function setupLetter() {
    const wrap = $('#letterWrap');
    const envelope = $('#envelope');
    const paper = $('#paper');
    const body = $('#letterBody');
    const replay = $('#replayLetter');
    const source = $('#letterSource');
    if (!wrap || !envelope || !paper || !body || !source) return;

    const text = source.textContent
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    let opened = false;
    let typing = false;
    let typeTimer = 0;
    let typedOnce = false;
    let resizeTimer = 0;

    function measureFull() {
      const backup = body.textContent;
      body.textContent = text;
      body.classList.remove('typing');
      const height = paper.offsetHeight;
      body.textContent = backup;
      return height;
    }

    function finishTyping() {
      window.clearTimeout(typeTimer);
      typing = false;
      body.textContent = text;
      body.classList.remove('typing');
      paper.classList.add('done');
      if (!typedOnce) {
        typedOnce = true;
        if (replay) replay.hidden = false;
      }
    }

    function typeLetter() {
      window.clearTimeout(typeTimer);
      body.textContent = '';
      paper.classList.remove('done');
      typing = true;

      if (reduceMotion) {
        finishTyping();
        return;
      }

      body.classList.add('typing');
      let i = 0;
      const step = () => {
        if (i >= text.length) {
          finishTyping();
          return;
        }
        const ch = text[i];
        i += 1;
        body.textContent += ch;
        let delay = 32;
        if ('，。！？'.indexOf(ch) !== -1) delay = 235;
        else if (ch === '\n') delay = 105;
        typeTimer = window.setTimeout(step, delay);
      };
      step();
    }

    function openLetter() {
      if (opened) return;
      opened = true;

      const start = wrap.offsetHeight;
      const target = measureFull();
      wrap.style.height = start + 'px';
      void wrap.offsetHeight;
      wrap.classList.add('open');
      envelope.setAttribute('aria-expanded', 'true');
      paper.setAttribute('aria-hidden', 'false');

      window.requestAnimationFrame(() => {
        wrap.style.height = target + 'px';
      });

      window.setTimeout(() => {
        envelope.setAttribute('aria-hidden', 'true');
        envelope.setAttribute('tabindex', '-1');
      }, 900);

      window.setTimeout(() => {
        typeLetter();
        paper.focus({ preventScroll: true });
      }, 500);

      haptic(12);
      Snow.burst(window.innerWidth / 2, window.innerHeight * .55, 20);
    }

    envelope.addEventListener('click', openLetter);

    paper.addEventListener('click', () => {
      if (typing) finishTyping();
    });

    if (replay) {
      replay.addEventListener('click', () => {
        if (!opened) return;
        wrap.style.height = measureFull() + 'px';
        typeLetter();
        haptic(8);
      });
    }

    window.addEventListener('resize', () => {
      if (!opened || typing) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        wrap.style.height = measureFull() + 'px';
      }, 220);
    }, { passive: true });
  }

  /* ---------------------------------------------------------
     终章：一起淋雪
     --------------------------------------------------------- */

  function setupFinale() {
    const btn = $('#stormBtn');
    const label = $('#stormLabel');
    const msg = $('#finaleMsg');
    const shareBtn = $('#shareBtn');
    const topBtn = $('#topBtn');
    if (!btn) return;

    let storming = false;
    let stormTimer = 0;

    function startStorm() {
      if (storming) return;
      storming = true;
      if (msg) msg.classList.add('in');
      btn.disabled = true;
      if (label) label.textContent = '正在下雪…';
      Snow.storm(true);
      haptic([10, 45, 18]);

      window.clearTimeout(stormTimer);
      stormTimer = window.setTimeout(() => {
        Snow.storm(false);
        storming = false;
        btn.disabled = false;
        if (label) label.textContent = '再淋一场';
      }, 9500);
    }

    btn.addEventListener('click', startStorm);

    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const data = {
          title: document.title,
          text: '今朝若是同淋雪，此生也算共白头。',
          url: window.location.href,
        };
        if (navigator.share) {
          try {
            await navigator.share(data);
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') return;
          }
        }
        try {
          await navigator.clipboard.writeText(window.location.href);
          toast('链接已复制，去分享吧');
        } catch (_) {
          toast('复制地址栏的链接，就可以分享了');
        }
      });
    }

    if (topBtn) {
      topBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }
  }

  /* ---------------------------------------------------------
     轻触生雪
     --------------------------------------------------------- */

  function setupTaps() {
    const hero = $('#hero');
    let down = null;

    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      down = { x: event.clientX, y: event.clientY, t: performance.now() };
    }, { passive: true });

    document.addEventListener('pointerup', (event) => {
      if (!down) return;
      const elapsed = performance.now() - down.t;
      const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (elapsed > 480 || distance > 14) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('a, button, input, textarea, select, label, .snowpad, .letter-wrap')) return;

      Snow.burst(event.clientX, event.clientY, 12);
      Snow.addWind(rand(-5, 5));
      haptic(5);

      if (!reduceMotion) {
        const wave = document.createElement('span');
        wave.className = 'tap-wave';
        wave.style.left = event.clientX + 'px';
        wave.style.top = event.clientY + 'px';
        document.body.appendChild(wave);
        window.setTimeout(() => wave.remove(), 1100);
      }

      if (hero && hero.contains(target)) hero.classList.add('tapped');
    }, { passive: true });
  }

  /* ---------------------------------------------------------
     手指带着雪走
     --------------------------------------------------------- */

  function setupWind() {
    let lastX = null;
    let lastTouchX = null;

    function push(dx) {
      if (Math.abs(dx) < 2) return;
      Snow.addWind(clamp(dx * .09, -4, 4));
    }

    window.addEventListener('pointermove', (event) => {
      if (lastX === null) {
        lastX = event.clientX;
        return;
      }
      push(event.clientX - lastX);
      lastX = event.clientX;
    }, { passive: true });

    window.addEventListener('pointerdown', (event) => {
      lastX = event.clientX;
      lastTouchX = event.clientX;
    }, { passive: true });

    // 手机上滚动时 pointermove 会被取消，touchmove 还能带着雪走
    window.addEventListener('touchmove', (event) => {
      if (!event.touches.length) return;
      const x = event.touches[0].clientX;
      if (lastTouchX !== null) push(x - lastTouchX);
      lastTouchX = x;
    }, { passive: true });
  }

  /* ---------------------------------------------------------
     启动
     --------------------------------------------------------- */

  function boot() {
    Snow.init();
    setupScroll();
    setupReveals();
    setupSnowpad();
    setupLetter();
    setupFinale();
    setupTaps();
    setupWind();

    // 开场一点雪，让首屏立刻有呼吸
    window.setTimeout(() => {
      Snow.burst(window.innerWidth * .5, window.innerHeight * .42, 16);
    }, 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
