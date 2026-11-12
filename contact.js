// Contact form. Posts to /api/contact on this site, which the server forwards to the
// message inbox. The rules below mirror the server's, so most mistakes are caught
// before sending, but the server's answer is final.
const form = document.getElementById('contactForm');
const LIMITS = { name: 100, email: 254, message: 5000, messageMin: 10 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELDS = ['name', 'email', 'message'];
// Interface strings: translated pages provide them in <script id="i18n">; English is the default.
const T = Object.assign({
  nameMissing: 'Please add your name.', nameLong: 'Keep it under 100 characters.',
  emailMissing: 'Please add your email so I can reply.', emailBad: 'That email address doesn’t look right.',
  messageMissing: 'Please write a message.', messageShort: 'Could you write a little more?', messageLong: 'Keep it under 5,000 characters.',
  sending: 'Sending…', send: 'Send message', sent: 'Thanks! Your message is on its way. I’ll reply by email.',
  checkForm: 'Please check the form.', failed: 'Sorry, that didn’t send. Please try again in a moment.',
  offline: 'Couldn’t reach the server. Check your connection and try again.',
}, (() => { try { return JSON.parse(document.getElementById('i18n')?.textContent || '{}'); } catch { return {}; } })());
// The server answers in English; translated pages show their own messages instead.
const localized = /^zh/.test(document.documentElement.lang);

if (form) {
  const status = document.getElementById('cformStatus');
  const button = form.querySelector('button[type="submit"]');
  const label = button.querySelector('span');
  let sending = false;

  const values = () => ({
    name: form.elements.name.value.trim(),
    email: form.elements.email.value.trim(),
    message: form.elements.message.value.trim(),
    website: form.elements.website.value,
  });

  function check(v) {
    const e = {};
    if (!v.name) e.name = T.nameMissing;
    else if (v.name.length > LIMITS.name) e.name = T.nameLong;
    if (!v.email) e.email = T.emailMissing;
    else if (v.email.length > LIMITS.email || !EMAIL_RE.test(v.email)) e.email = T.emailBad;
    if (!v.message) e.message = T.messageMissing;
    else if (v.message.length < LIMITS.messageMin) e.message = T.messageShort;
    else if (v.message.length > LIMITS.message) e.message = T.messageLong;
    return e;
  }

  function setError(name, msg) {
    const input = form.elements[name];
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    form.querySelector(`[data-error-for="${name}"]`).textContent = msg || '';
  }
  const showErrors = (errors) => FIELDS.forEach((f) => setError(f, errors[f]));

  function setStatus(kind, text) {
    status.dataset.kind = kind;
    status.textContent = text;
  }

  // Once a field is flagged, re-check it as the visitor types.
  FIELDS.forEach((f) => form.elements[f].addEventListener('input', () => {
    if (form.elements[f].getAttribute('aria-invalid') === 'true') setError(f, check(values())[f]);
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const v = values();
    const errors = check(v);
    showErrors(errors);
    const first = FIELDS.find((f) => errors[f]);
    if (first) { form.elements[first].focus(); setStatus('', ''); return; }

    sending = true;
    button.disabled = true;
    label.textContent = T.sending;
    form.setAttribute('aria-busy', 'true');
    setStatus('', '');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: v.name, email: v.email, message: v.message, website: v.website }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        form.reset();
        showErrors({});
        setStatus('success', T.sent);
      } else if (res.status === 422 && data.errors) {
        // Field errors come back in English; translated pages use their own message per field.
        showErrors(localized ? Object.fromEntries(Object.keys(data.errors).map((f) => [f, check(v)[f] || T.checkForm])) : data.errors);
        setStatus('error', localized ? T.checkForm : data.error || T.checkForm);
      } else {
        setStatus('error', (!localized && data.error) || T.failed);
      }
    } catch {
      setStatus('error', T.offline);
    } finally {
      sending = false;
      button.disabled = false;
      label.textContent = T.send;
      form.removeAttribute('aria-busy');
    }
  });
}
