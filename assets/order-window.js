/**
 * Bakery Order Window — Client-side controller
 *
 * Reads window state from BAKERY_WINDOW global (set by Liquid snippet).
 * Handles:
 *   - Storefront redirect to /pages/waitlist when window is closed
 *   - Announcement bar rendering + last-24h countdown
 *   - Live order counter polling (every 60s)
 *   - Delivery day selector validation
 *
 * COPY RULE: Never use "midnight" — always "Wednesday 11:59pm"
 */

(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────
  // Set by the Liquid snippet: window.BAKERY_WINDOW = { open: true/false }
  const state = window.BAKERY_WINDOW || { open: false };
  const ORDER_COUNT_URL = '/api/order-count'; // your Vercel deployment URL in production
  const POLL_INTERVAL_MS = 60 * 1000;

  // Paths exempt from redirect when window is closed
  const EXEMPT_PATHS = [
    '/pages/waitlist',
    '/account',
    '/challenge',
    '/password',
  ];

  // ─── Redirect ───────────────────────────────────────────────────────────────
  function shouldRedirect() {
    if (state.open) return false;
    const path = window.location.pathname;
    // Exempt waitlist page, account pages, JSON endpoints, Shopify internals
    if (path === '/pages/waitlist') return false;
    if (EXEMPT_PATHS.some((p) => path.startsWith(p))) return false;
    if (path.endsWith('.js') || path.endsWith('.json') || path.endsWith('.css')) return false;
    if (path.startsWith('/admin') || path.startsWith('/services')) return false;
    return true;
  }

  if (shouldRedirect()) {
    window.location.replace('/pages/waitlist');
    return; // Stop all further execution
  }

  // ─── Announcement bar ───────────────────────────────────────────────────────
  function getNextWednesdayClose() {
    // Returns the next Wednesday 23:59:59 in Europe/London as a UTC timestamp
    const now = new Date();
    const londonNow = toLondonParts(now);
    const dayIndex = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      .indexOf(londonNow.weekday);

    // Days until next Wednesday
    let daysUntilWed = (3 - dayIndex + 7) % 7;
    if (daysUntilWed === 0 && (londonNow.hour > 23 || (londonNow.hour === 23 && londonNow.minute >= 59))) {
      daysUntilWed = 7; // Already past close time on Wednesday
    }

    const closeDate = new Date(now);
    closeDate.setDate(closeDate.getDate() + daysUntilWed);

    // Set to 23:59:00 in London time — approximate via UTC offset
    const offset = getLondonUTCOffsetMinutes(closeDate);
    closeDate.setUTCHours(23 - Math.floor(offset / 60));
    closeDate.setUTCMinutes(59 - (offset % 60));
    closeDate.setUTCSeconds(0);
    return closeDate;
  }

  function getLondonUTCOffsetMinutes(date) {
    // Returns London's UTC offset in minutes (0 for GMT, 60 for BST)
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
    const lonStr = date.toLocaleString('en-US', { timeZone: 'Europe/London', hour12: false });
    const diff = (new Date(lonStr) - new Date(utcStr)) / 60000;
    return Math.round(diff);
  }

  function toLondonParts(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/London',
      weekday: 'long',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
    return {
      weekday: parts.weekday,
      hour: parseInt(parts.hour === '24' ? '0' : parts.hour),
      minute: parseInt(parts.minute),
    };
  }

  function isLast24Hours() {
    const close = getNextWednesdayClose();
    const now = new Date();
    const hoursUntilClose = (close - now) / 3600000;
    return hoursUntilClose > 0 && hoursUntilClose <= 24;
  }

  function renderAnnouncementBar() {
    const bar = document.getElementById('bakery-announcement-bar');
    if (!bar) return;

    if (!state.open) {
      bar.innerHTML = `
        <span class="bakery-bar__dot bakery-bar__dot--closed">●</span>
        Orders closed — next window opens Sunday.
        <a href="/pages/waitlist" class="bakery-bar__link">Join the waitlist →</a>
      `;
      bar.className = 'bakery-announcement-bar bakery-announcement-bar--closed';
      return;
    }

    if (isLast24Hours()) {
      bar.innerHTML = `
        <span class="bakery-bar__dot bakery-bar__dot--urgent">⏰</span>
        Last chance — orders close <strong>Wednesday 11:59pm</strong>
      `;
      bar.className = 'bakery-announcement-bar bakery-announcement-bar--urgent';
    } else {
      bar.innerHTML = `
        <span class="bakery-bar__dot bakery-bar__dot--open">●</span>
        Orders open — Order by <strong>Wednesday 11:59pm</strong> for Friday/Saturday delivery
      `;
      bar.className = 'bakery-announcement-bar bakery-announcement-bar--open';
    }
  }

  // ─── Live order counter ─────────────────────────────────────────────────────
  function updateOrderCounter(data) {
    const els = document.querySelectorAll('[data-bakery-order-count]');
    if (!els.length) return;

    if (!data.window_open) {
      els.forEach((el) => (el.style.display = 'none'));
      return;
    }

    const text =
      data.count >= data.max
        ? '⚠️ Almost full — order by Wednesday 11:59pm'
        : `🍞 ${data.count} orders placed this window — order by Wednesday 11:59pm`;

    els.forEach((el) => {
      el.textContent = text;
      el.style.display = '';
      el.dataset.nearCapacity = String(data.count >= data.max);
    });
  }

  async function fetchOrderCount() {
    try {
      const res = await fetch(ORDER_COUNT_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      updateOrderCounter(data);
    } catch {
      // Silently fail — counter is non-critical
    }
  }

  function startOrderCountPolling() {
    if (!document.querySelector('[data-bakery-order-count]')) return;
    fetchOrderCount();
    setInterval(fetchOrderCount, POLL_INTERVAL_MS);
  }

  // ─── Delivery day selector ──────────────────────────────────────────────────
  // Also handled by delivery-selector.liquid snippet — this provides the JS logic
  function initDeliverySelector() {
    const selectors = document.querySelectorAll('[data-delivery-selector]');
    selectors.forEach((wrapper) => {
      const buttons = wrapper.querySelectorAll('[data-delivery-option]');
      const hiddenInput = wrapper.querySelector('[data-delivery-value]');
      const addToCartBtn = wrapper.closest('form')?.querySelector('[data-add-to-cart]');
      const validationMsg = wrapper.querySelector('[data-delivery-validation]');

      if (!buttons.length) return;

      // Initially disable add to cart
      if (addToCartBtn) {
        addToCartBtn.disabled = true;
        addToCartBtn.dataset.originalText = addToCartBtn.textContent;
      }

      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          buttons.forEach((b) => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          if (hiddenInput) hiddenInput.value = btn.dataset.deliveryOption;
          if (validationMsg) validationMsg.hidden = true;
          if (addToCartBtn) addToCartBtn.disabled = false;
        });
      });

      // Intercept form submit — validate delivery selection
      const form = wrapper.closest('form');
      if (form) {
        form.addEventListener('submit', (e) => {
          if (!hiddenInput?.value) {
            e.preventDefault();
            if (validationMsg) validationMsg.hidden = false;
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      }
    });
  }

  // ─── Waitlist countdown timer ───────────────────────────────────────────────
  function getNextSundayMidnightLondon() {
    const now = new Date();
    const londonNow = toLondonParts(now);
    const dayIndex = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      .indexOf(londonNow.weekday);
    const daysUntilSun = dayIndex === 0 ? 7 : 7 - dayIndex;

    const target = new Date(now);
    target.setDate(target.getDate() + daysUntilSun);

    // Midnight London = offset midnight in UTC
    const offset = getLondonUTCOffsetMinutes(target);
    target.setUTCHours(0 - Math.floor(offset / 60));
    target.setUTCMinutes(0 - (offset % 60));
    target.setUTCSeconds(0);
    target.setUTCMilliseconds(0);
    return target;
  }

  function formatCountdown(ms) {
    if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { days, hours, minutes, seconds };
  }

  function initWaitlistCountdown() {
    const el = document.getElementById('bakery-countdown');
    if (!el) return;

    function tick() {
      const target = getNextSundayMidnightLondon();
      const { days, hours, minutes, seconds } = formatCountdown(target - new Date());
      el.innerHTML = `
        <div class="bakery-countdown__unit"><span class="bakery-countdown__num">${String(days).padStart(2,'0')}</span><span class="bakery-countdown__label">Days</span></div>
        <div class="bakery-countdown__sep">:</div>
        <div class="bakery-countdown__unit"><span class="bakery-countdown__num">${String(hours).padStart(2,'0')}</span><span class="bakery-countdown__label">Hours</span></div>
        <div class="bakery-countdown__sep">:</div>
        <div class="bakery-countdown__unit"><span class="bakery-countdown__num">${String(minutes).padStart(2,'0')}</span><span class="bakery-countdown__label">Mins</span></div>
        <div class="bakery-countdown__sep">:</div>
        <div class="bakery-countdown__unit"><span class="bakery-countdown__num">${String(seconds).padStart(2,'0')}</span><span class="bakery-countdown__label">Secs</span></div>
      `;
    }
    tick();
    setInterval(tick, 1000);
  }

  // ─── Waitlist form submission ───────────────────────────────────────────────
  function initWaitlistForm() {
    const form = document.getElementById('bakery-waitlist-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('[type="submit"]');
      const successMsg = document.getElementById('bakery-waitlist-success');
      const errorMsg = document.getElementById('bakery-waitlist-error');

      const email = form.querySelector('[name="email"]')?.value?.trim();
      const postcode = form.querySelector('[name="postcode"]')?.value?.trim().toUpperCase();

      if (!email) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding you…';
      if (errorMsg) errorMsg.hidden = true;

      try {
        const res = await fetch('/api/waitlist-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, postcode }),
        });

        if (!res.ok) throw new Error(await res.text());

        form.hidden = true;
        if (successMsg) successMsg.hidden = false;
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Join the waitlist';
        if (errorMsg) {
          errorMsg.textContent = 'Something went wrong. Please try again.';
          errorMsg.hidden = false;
        }
      }
    });
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    renderAnnouncementBar();
    startOrderCountPolling();
    initDeliverySelector();
    initWaitlistCountdown();
    initWaitlistForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
