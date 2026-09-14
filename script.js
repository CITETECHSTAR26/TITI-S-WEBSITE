'use strict';

/*
  StudySpace frontend prototype
  ---------------------------------------------------------------
  IMPORTANT FOR PRODUCTION:
  - Payment verification must happen on a trusted backend/server.
  - Permanent booking storage must use a secure database, not localStorage.
  - Access-code validation must happen server-side.
  - Zoom meeting links / credentials must never be exposed in production JS.
  - Email confirmations should be sent by a backend or secure provider.
  - Admin session management needs authenticated server-side tooling.

  This demo intentionally stores non-sensitive booking data in localStorage
  only to simulate the complete frontend experience.
*/

const HOURLY_RATE = 5;
const MAX_BOOKING_HOURS = 4;

// Each date exposes the one-hour blocks the host is available.
// In production this availability should come from a backend/admin calendar.
const sessions = [
  { date: '2026-09-19', day: 'Saturday', availableHours: [8,9,10,11,12,13,14,15,16,17,18,19,20,21] },
  { date: '2026-09-20', day: 'Sunday', availableHours: [10,11,12,13,14,15,16,17,18,19,20] },
  { date: '2026-09-21', day: 'Monday', availableHours: [9,10,11,12,13,14,15,16,17,18,19,20] },
  { date: '2026-09-22', day: 'Tuesday', availableHours: [8,9,10,11,12,13,14,15,16,17,18,19,20,21] },
  { date: '2026-09-23', day: 'Wednesday', availableHours: [8,9,10,11,12,13,14,15,16,17,18,19,20] },
  { date: '2026-09-24', day: 'Thursday', availableHours: [8,9,10,11,12,13,14,15,16,17,18,19,20,21] },
  { date: '2026-09-25', day: 'Friday', availableHours: [8,9,10,11,12,13,14,15,16,17,18,19,20] },
  { date: '2026-09-26', day: 'Saturday', availableHours: [8,9,10,11,12,13,14,15,16,17,18,19,20,21] },
  { date: '2026-09-27', day: 'Sunday', availableHours: [10,11,12,13,14,15,16,17,18,19,20] }
];

const ZOOM_PLACEHOLDER_URL = 'https://zoom.us/';
const STORAGE_KEY = 'studyspace_bookings_v1';
const PENDING_BOOKING_KEY = 'studyspace_pending_booking';
const THEME_STORAGE_KEY = 'studyspace_theme';

const STRIPE_PAYMENT_LINKS = {
  1: 'https://buy.stripe.com/fZueVdaVteU44rT6SE8ww00', // 1 Hour = €5
  2: 'https://buy.stripe.com/fZubJ1e7FeU4cYpel68ww01', // 2 Hours = €10
  3: 'YOUR_3_HOUR_STRIPE_LINK', // 3 Hours = €15
  4: 'YOUR_4_HOUR_STRIPE_LINK'  // 4 Hours = €20
};

let selectedSession = null;
let selectedSlot = null;
let selectedStartHour = null;
let selectedDuration = 1;
let bookingDraft = null;
let lastFocusedElement = null;

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function parseDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function formatLongDate(dateString) {
  return new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parseDate(dateString));
}

function formatShortDate(dateString) {
  return new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseDate(dateString));
}

function getStoredBookings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveBooking(booking) {
  const bookings = getStoredBookings();
  bookings.push(booking);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
}

function showToast(title, message, type = 'success') {
  const stack = $('#toastStack');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  toast.innerHTML = `<span class="toast-icon">${type === 'error' ? '!' : '✓'}</span><div><strong>${title}</strong><p>${message}</p></div>`;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 220);
  }, 3300);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  lastFocusedElement = document.activeElement;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  setTimeout(() => $('.modal', modal)?.focus(), 30);
}

function closeModal(id, restoreFocus = true) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!$$('.modal-backdrop.open').length) document.body.classList.remove('modal-open');
  if (restoreFocus) lastFocusedElement?.focus?.();
}

function trapFocus(event, modalBackdrop) {
  if (event.key !== 'Tab') return;
  const focusables = $$('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', modalBackdrop)
    .filter(el => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

function renderDates() {
  const dateList = $('#dateList');
  const todayISO = new Date().toISOString().slice(0, 10);
  dateList.innerHTML = sessions.map((session, index) => {
    const d = parseDate(session.date);
    const dayName = new Intl.DateTimeFormat('en-NG', { weekday: 'short' }).format(d).toUpperCase();
    const month = new Intl.DateTimeFormat('en-NG', { month: 'short' }).format(d).toUpperCase();
    return `
      <button class="date-card" type="button" role="option" aria-selected="false" data-index="${index}">
        ${session.date === todayISO ? '<span class="today-dot" title="Today"></span>' : ''}
        <small>${dayName}</small>
        <strong>${d.getDate()}</strong>
        <span>${month}</span>
      </button>`;
  }).join('');

  $$('.date-card', dateList).forEach(card => {
    card.addEventListener('click', () => selectDate(Number(card.dataset.index)));
  });
}

function formatHour(hour24) {
  const normalized = ((hour24 % 24) + 24) % 24;
  const hour12 = normalized % 12 || 12;
  const period = normalized >= 12 ? 'PM' : 'AM';
  return `${String(hour12).padStart(2, '0')}:00 ${period}`;
}

function canBookDuration(startHour, hours) {
  if (!selectedSession) return false;
  const available = new Set(selectedSession.availableHours);
  return Array.from({ length: hours }, (_, offset) => available.has(startHour + offset)).every(Boolean);
}

function createSelectedSlot(startHour, hours) {
  return {
    startHour,
    endHour: startHour + hours,
    start: formatHour(startHour),
    end: formatHour(startHour + hours),
    durationHours: hours,
    duration: `${hours} Hour${hours === 1 ? '' : 's'}`,
    price: HOURLY_RATE * hours,
    type: 'Focused Study Session'
  };
}

function selectDate(index) {
  selectedSession = sessions[index];
  selectedSlot = null;
  selectedStartHour = null;
  selectedDuration = 1;

  $$('.date-card').forEach((card, i) => {
    const selected = i === index;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-selected', String(selected));
  });

  $('#selectedDateLabel').textContent = formatLongDate(selectedSession.date);
  $('#durationPanel').hidden = true;
  resetSummary();
  renderTimeSlots();
}

function renderTimeSlots() {
  const timeList = $('#timeList');
  if (!selectedSession) return;

  timeList.innerHTML = selectedSession.availableHours.map(hour => `
    <button class="time-card" type="button" data-start-hour="${hour}" aria-pressed="false">
      <div class="slot-top">
        <div>
          <h4>${formatHour(hour)}</h4>
          <p class="slot-range">Start your study session</p>
        </div>
        <span class="slot-status available">Available</span>
      </div>
      <div class="slot-meta"><span>Choose 1–${MAX_BOOKING_HOURS} hours</span><span>Virtual Focus Room</span></div>
      <div class="slot-price">${formatCurrency(HOURLY_RATE)} / hour</div>
    </button>`).join('');

  $$('.time-card', timeList).forEach(card => {
    card.addEventListener('click', () => selectTime(Number(card.dataset.startHour)));
  });
}

function selectTime(startHour) {
  selectedStartHour = startHour;
  selectedDuration = 1;
  selectedSlot = createSelectedSlot(startHour, selectedDuration);

  $$('.time-card').forEach(card => {
    const selected = Number(card.dataset.startHour) === startHour;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  });

  $('#durationPanel').hidden = false;
  $('#selectedStartLabel').textContent = `Starting at ${formatHour(startHour)}`;
  renderDurationOptions();
  updateSummary();
  $('#durationPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDurationOptions() {
  const container = $('#durationOptions');
  container.innerHTML = Array.from({ length: MAX_BOOKING_HOURS }, (_, i) => i + 1).map(hours => {
    const available = canBookDuration(selectedStartHour, hours);
    return `
      <button class="duration-chip ${selectedDuration === hours ? 'selected' : ''}" type="button" data-hours="${hours}" ${available ? '' : 'disabled'} aria-pressed="${selectedDuration === hours}">
        <strong>${hours} ${hours === 1 ? 'Hour' : 'Hours'}</strong>
        <span>${formatCurrency(HOURLY_RATE * hours)}</span>
      </button>`;
  }).join('');

  $$('.duration-chip', container).forEach(button => {
    if (!button.disabled) button.addEventListener('click', () => selectDuration(Number(button.dataset.hours)));
  });
  updateDurationPreview();
}

function selectDuration(hours) {
  if (!canBookDuration(selectedStartHour, hours)) return;
  selectedDuration = hours;
  selectedSlot = createSelectedSlot(selectedStartHour, hours);
  $$('.duration-chip').forEach(button => {
    const selected = Number(button.dataset.hours) === hours;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  updateDurationPreview();
  updateSummary();
}

function updateDurationPreview() {
  if (!selectedSlot) return;
  $('#durationPreview').innerHTML = `
    <span>${selectedSlot.start} – ${selectedSlot.end}</span>
    <strong>${selectedSlot.duration} · ${formatCurrency(selectedSlot.price)}</strong>`;
}

function resetSummary() {
  $('#summaryPlaceholder').hidden = false;
  $('#summaryContent').hidden = true;
}

function updateSummary() {
  if (!selectedSession || !selectedSlot) return resetSummary();
  $('#summaryPlaceholder').hidden = true;
  $('#summaryContent').hidden = false;
  $('#summaryDate').textContent = formatLongDate(selectedSession.date);
  $('#summaryTime').textContent = `${selectedSlot.start} – ${selectedSlot.end}`;
  $('#summaryDuration').textContent = selectedSlot.duration;
  $('#summaryPrice').textContent = formatCurrency(selectedSlot.price);
}

function buildModalSummary() {
  $('#modalBookingSummary').innerHTML = `
    <span><strong>${formatShortDate(selectedSession.date)}</strong></span>
    <span>${selectedSlot.start} – ${selectedSlot.end}</span>
    <span>${selectedSlot.duration}</span>
    <span><strong>${formatCurrency(selectedSlot.price)}</strong></span>`;
  $('#bookingButtonPrice').textContent = formatCurrency(selectedSlot.price);
}

function validateBookingForm() {
  const fields = {
    fullName: $('#fullName').value.trim(),
    email: $('#email').value.trim(),
    phone: $('#phone').value.trim(),
    studyGoal: $('#studyGoal').value.trim(),
    guidelines: $('#guidelines').checked
  };
  const errors = {};
  if (fields.fullName.length < 2) errors.fullName = 'Please enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = 'Enter a valid email address.';
  if (!/^[+\d][\d\s()-]{7,}$/.test(fields.phone)) errors.phone = 'Enter a valid phone number.';
  if (fields.studyGoal.length < 8) errors.studyGoal = 'Tell us briefly what you plan to work on.';
  if (!fields.guidelines) errors.guidelines = 'Please agree to the focus-room guidelines.';

  Object.keys(fields).forEach(name => {
    const input = document.getElementById(name);
    const error = $(`[data-error-for="${name}"]`);
    if (error) error.textContent = errors[name] || '';
    if (input && input.type !== 'checkbox') input.classList.toggle('invalid', Boolean(errors[name]));
  });

  if (Object.keys(errors).length) {
    const first = document.getElementById(Object.keys(errors)[0]);
    first?.focus();
    return null;
  }
  return fields;
}

function openPayment(fields) {
  bookingDraft = {
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `booking-${Date.now()}`,
    fullName: fields.fullName,
    email: fields.email,
    phone: fields.phone,
    studyGoal: fields.studyGoal,
    date: selectedSession.date,
    day: selectedSession.day,
    start: selectedSlot.start,
    end: selectedSlot.end,
    duration: selectedSlot.duration,
    durationHours: selectedSlot.durationHours,
    ratePerHour: HOURLY_RATE,
    sessionType: selectedSlot.type,
    price: selectedSlot.price,
    room: 'Virtual Focus Room',
    platform: 'Zoom',
    createdAt: new Date().toISOString()
  };
  $('#paymentOverview').innerHTML = `
    <div><span>Booking amount</span><strong>${formatCurrency(bookingDraft.price)}</strong></div>
    <div><span>Selected session</span><strong>${formatShortDate(bookingDraft.date)}, ${bookingDraft.start} – ${bookingDraft.end}</strong></div>
    <div><span>Rate</span><strong>${formatCurrency(HOURLY_RATE)} / hour</strong></div>
    <div><span>Name</span><strong>${escapeHTML(bookingDraft.fullName)}</strong></div>
    <div><span>Email</span><strong>${escapeHTML(bookingDraft.email)}</strong></div>`;
  closeModal('bookingModal', false);
  openModal('paymentModal');
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function generateAccessCode(existingCodes) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chunk = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  let code;
  do { code = `STUDY-${chunk()}-${chunk()}`; } while (existingCodes.has(code));
  return code;
}

function redirectToStripeCheckout() {
  if (!bookingDraft) {
    showToast('Booking incomplete', 'Please complete your booking before proceeding to payment.', 'error');
    return;
  }

  const hours = Number(bookingDraft.durationHours);
  const paymentLink = STRIPE_PAYMENT_LINKS[hours];

  if (!paymentLink) {
    showToast('Invalid duration', 'Please select between 1 and 4 hours.', 'error');
    return;
  }

  if (paymentLink.includes('YOUR_')) {
    showToast('Payment link unavailable', `The ${hours}-hour Stripe payment link has not been configured yet.`, 'error');
    return;
  }

  localStorage.setItem(PENDING_BOOKING_KEY, JSON.stringify(bookingDraft));

  const stripeUrl = new URL(paymentLink);
  if (bookingDraft.email) stripeUrl.searchParams.set('prefilled_email', bookingDraft.email);
  if (bookingDraft.id) stripeUrl.searchParams.set('client_reference_id', bookingDraft.id);

  window.location.assign(stripeUrl.toString());
}

// Backend hook: call this only after Stripe payment has been verified server-side.
function confirmBookingAfterVerifiedPayment() {
  if (!bookingDraft) return;
  const bookings = getStoredBookings();
  const existing = new Set(bookings.map(b => b.accessCode));
  bookingDraft.accessCode = generateAccessCode(existing);
  bookingDraft.paymentStatus = 'simulated_success';
  bookingDraft.zoomUrl = ZOOM_PLACEHOLDER_URL;
  saveBooking(bookingDraft);
  showSuccessModal(bookingDraft);
}

function showSuccessModal(booking) {
  $('#generatedAccessCode').textContent = booking.accessCode;
  $('#successSessionDetails').innerHTML = `<strong>${formatShortDate(booking.date)}</strong><br>${booking.start} – ${booking.end} · ${booking.sessionType}`;
  closeModal('paymentModal', false);
  openModal('successModal');
  launchConfetti();
  showToast('Booking confirmed', 'Your access code has been generated and saved in this browser.');
}

async function copyAccessCode() {
  const code = $('#generatedAccessCode').textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    $('#copyCodeBtn').textContent = 'Copied ✓';
    showToast('Access code copied', 'Paste it into the Join Study Session section when you are ready.');
    setTimeout(() => $('#copyCodeBtn').textContent = 'Copy Access Code', 1800);
  } catch {
    showToast('Copy failed', 'Please select and copy the code manually.', 'error');
  }
}

function getBookingDateTimes(booking) {
  const convert = (time) => {
    const [clock, period] = time.split(' ');
    let [hour, minute] = clock.split(':').map(Number);
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return { hour, minute };
  };
  const startParts = convert(booking.start);
  const endParts = convert(booking.end);
  const start = parseDate(booking.date);
  start.setHours(startParts.hour, startParts.minute, 0, 0);
  const end = parseDate(booking.date);
  end.setHours(endParts.hour, endParts.minute, 0, 0);
  return { start, end };
}

function toICSDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function addToCalendar() {
  if (!bookingDraft) return;
  const { start, end } = getBookingDateTimes(bookingDraft);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StudySpace//Study Session//EN', 'BEGIN:VEVENT',
    `UID:${bookingDraft.id}@studyspace.local`, `DTSTAMP:${toICSDate(new Date())}`, `DTSTART:${toICSDate(start)}`, `DTEND:${toICSDate(end)}`,
    `SUMMARY:${bookingDraft.sessionType}`, `DESCRIPTION:StudySpace virtual focus session. Access code: ${bookingDraft.accessCode}`, `URL:${ZOOM_PLACEHOLDER_URL}`,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'studyspace-session.ics';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  showToast('Calendar file created', 'Open the downloaded .ics file to add the session to your calendar.');
}

function verifyAccessCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  const result = $('#verifyResult');
  if (!code) {
    result.innerHTML = '<div class="verify-card error"><h4>Enter your access code</h4><p>Use the code shown after your booking was confirmed.</p></div>';
    return;
  }
  const booking = getStoredBookings().find(item => item.accessCode === code);
  if (!booking) {
    result.innerHTML = '<div class="verify-card error"><h4>We couldn’t verify this access code.</h4><p>Please check the code and try again. This prototype can only verify bookings stored in this browser.</p></div>';
    return;
  }
  result.innerHTML = `
    <div class="verify-card success">
      <h4>Access Verified ✓</h4>
      <p>Welcome, ${escapeHTML(booking.fullName)}.</p>
      <div class="verified-details"><span><strong>${formatShortDate(booking.date)}</strong></span><span>${booking.start} – ${booking.end}</span><span>${escapeHTML(booking.sessionType)}</span></div>
      <a class="btn btn-primary" href="${ZOOM_PLACEHOLDER_URL}" target="_blank" rel="noopener">Join Zoom Study Room</a>
    </div>`;
  showToast('Access verified', 'Your Zoom study room button is now available.');
}

function launchConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const count = 42;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.setProperty('--duration', `${2.2 + Math.random() * 1.8}s`);
    piece.style.setProperty('--drift', `${-80 + Math.random() * 160}px`);
    piece.style.setProperty('--rotation', `${Math.random() * 180}deg`);
    piece.style.setProperty('--hue', `${200 + Math.random() * 100}`);
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4300);
  }
}

function setupFAQ() {
  $$('.faq-question').forEach(button => {
    button.addEventListener('click', () => {
      const willOpen = button.getAttribute('aria-expanded') !== 'true';
      $$('.faq-question').forEach(other => other.setAttribute('aria-expanded', 'false'));
      button.setAttribute('aria-expanded', String(willOpen));
    });
  });
}

function setupStats() {
  const stats = $$('.stat-number');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || entry.target.dataset.counted) return;
      entry.target.dataset.counted = 'true';
      const el = entry.target;
      const target = Number(el.dataset.target);
      const decimals = Number(el.dataset.decimals || 0);
      const suffix = el.dataset.suffix || '';
      const startTime = performance.now();
      const duration = 1200;
      const tick = now => {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = `${(target * eased).toFixed(decimals)}${suffix}`;
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: .55 });
  stats.forEach(stat => observer.observe(stat));
}

function setupRevealAnimations() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .12 });
  $$('.reveal').forEach(el => observer.observe(el));
}

function setupHeader() {
  const header = $('#siteHeader');
  const progress = $('#scrollProgress');
  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 12);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
  };
  document.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function setupMobileMenu() {
  const toggle = $('#menuToggle');
  const menu = $('#mobileMenu');
  const close = () => {
    toggle.classList.remove('active'); toggle.setAttribute('aria-expanded', 'false'); menu.hidden = true;
  };
  toggle.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  $$('a', menu).forEach(link => link.addEventListener('click', close));
  window.addEventListener('resize', () => { if (window.innerWidth > 1050) close(); });
}

function setupTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_STORAGE_KEY, next);
  });
}

function setupBookingFlow() {
  $('#continueBookingBtn').addEventListener('click', () => {
    if (!selectedSession || !selectedSlot) return;
    buildModalSummary();
    openModal('bookingModal');
  });

  $('#bookingForm').addEventListener('submit', event => {
    event.preventDefault();
    const fields = validateBookingForm();
    if (fields) openPayment(fields);
  });

  ['fullName','email','phone','studyGoal'].forEach(id => {
    $(`#${id}`).addEventListener('input', event => {
      event.target.classList.remove('invalid');
      $(`[data-error-for="${id}"]`).textContent = '';
    });
  });
  $('#guidelines').addEventListener('change', () => $('[data-error-for="guidelines"]').textContent = '');

  $('#paySecurelyBtn').addEventListener('click', redirectToStripeCheckout);

  $('#copyCodeBtn').addEventListener('click', copyAccessCode);
  $('#addCalendarBtn').addEventListener('click', addToCalendar);
  $('#successJoinBtn').addEventListener('click', () => closeModal('successModal', false));
}

function setupModals() {
  $$('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
  $$('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) closeModal(backdrop.id); });
    backdrop.addEventListener('keydown', event => trapFocus(event, backdrop));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const open = $('.modal-backdrop.open');
      if (open) closeModal(open.id);
    }
  });
}

function setupJoin() {
  $('#verifyForm').addEventListener('submit', event => {
    event.preventDefault();
    verifyAccessCode($('#accessCodeInput').value);
  });
  $('#accessCodeInput').addEventListener('input', event => {
    let value = event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    event.target.value = value.slice(0, 15);
  });
}

function setupDateScroll() {
  const list = $('#dateList');
  $('#dateScrollPrev').addEventListener('click', () => list.scrollBy({ left: -260, behavior: 'smooth' }));
  $('#dateScrollNext').addEventListener('click', () => list.scrollBy({ left: 260, behavior: 'smooth' }));
}

function setupFloatingButton() {
  $('#floatingBook').addEventListener('click', () => $('#sessions').scrollIntoView({ behavior: 'smooth' }));
}

function init() {
  setupTheme();
  setupHeader();
  setupMobileMenu();
  setupRevealAnimations();
  setupStats();
  setupFAQ();
  setupModals();
  setupJoin();
  setupBookingFlow();
  renderDates();
  setupDateScroll();
  setupFloatingButton();
}

document.addEventListener('DOMContentLoaded', init);
