// ==UserScript==
// @name         GitHub Codex Quick Comments
// @namespace    https://supermarsx.github.io/userscripts
// @version      1.3.0
// @description  Quick preset comment buttons + optional auto-confirm on PR merge dialogs.
// @author       supermarsx
// @match        https://github.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PHRASES = {
    fix: '@codex fix comments',
    review: '@codex review',
    go: '@codex go go go',
  };

  // ---------- Styles ----------
  const STYLE = [
    '.codex-quickbar { display:flex; gap:6px; flex-wrap:wrap; margin:6px 0 2px; align-items:center; }',
    '.codex-quickbar button { border:1px solid var(--borderColor-muted, #30363d); background:var(--bgColor-default, #0d1117); color:var(--fgColor-default, #c9d1d9); padding:4px 8px; border-radius:6px; font-size:12px; line-height:18px; cursor:pointer; }',
    '.codex-quickbar button:hover { background:var(--bgColor-muted, #161b22); }',
    '.codex-quickbar .codex-label { opacity:0.75; font-size:12px; margin-right:4px; }',
    '.codex-toggle { position:fixed; left:12px; bottom:12px; z-index:9999; display:flex; gap:8px; align-items:center; background:var(--bgColor-default, #0d1117); border:1px solid var(--borderColor-muted, #30363d); padding:6px 10px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,.3); }',
    '.codex-toggle button { border:1px solid var(--borderColor-muted, #30363d); background:transparent; color:var(--fgColor-default, #c9d1d9); padding:4px 8px; border-radius:6px; font-size:12px; line-height:18px; cursor:pointer; }',
    '.codex-toggle button:hover { background:var(--bgColor-muted, #161b22); }'
  ].join('\n');

  const styleTag = document.createElement('style');
  styleTag.textContent = STYLE;
  document.documentElement.appendChild(styleTag);

  // ---------- Helpers ----------
  function getLabelText(el){
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const val  = (('value' in el ? el.value : '') || '').toLowerCase();
    const deep = (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return (aria + ' ' + val + ' ' + deep).trim();
  }
  function isVisible(el){
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }

  // ---------- Auto Confirm Merge (toggle + logic) ----------
  const STORAGE_KEY = 'codex_auto_confirm_merge';
  function loadAutoConfirmPref() {
    try { return localStorage.getItem(STORAGE_KEY) !== '0'; } catch (_) { return true; }
  }
  function saveAutoConfirmPref(v) {
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch (_) {}
  }
  let autoConfirmMerge = loadAutoConfirmPref();
  let lastMergeClick = 0;

  function buildAutoConfirmToggle() {
    if (document.querySelector('.codex-toggle')) return;
    const wrap = document.createElement('div');
    wrap.className = 'codex-toggle';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.classList.add('codex-toggle-btn');
    function sync() {
      btn.textContent = autoConfirmMerge ? 'Disable auto confirm merge' : 'Enable auto confirm merge';
      btn.setAttribute('aria-pressed', String(autoConfirmMerge));
      btn.title = 'Toggle automatic clicking of "Confirm merge" on PRs';
    }
    btn.addEventListener('click', () => {
      autoConfirmMerge = !autoConfirmMerge;
      saveAutoConfirmPref(autoConfirmMerge);
      sync();
    });
    sync();
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }

  function findConfirmMergeButton(){
    window.console.log("TEST")
    // Only search in merge UI contexts (avoid our own toggle or unrelated buttons)
    const ctxSelector = [
      '#discussion_bucket',
      '#partial-pull-merging',
      '.js-merge-pr',
      '.merge-branch-action',
      'form[action*="/merge"]',
      '.details-dialog[open]',
      'dialog[open]'
    ].join(',');

    const scopes = document.querySelectorAll(ctxSelector);
    const pool = new Set();
    // include type=button + type=submit, because GitHub often uses type=button with nested spans
    scopes.forEach(sc => sc.querySelectorAll('button, input[type="submit"]').forEach(el => pool.add(el)));

    const candidates = Array.from(pool)
      .filter(el => !el.disabled && isVisible(el))
      .filter(el => !el.closest('.codex-toggle') && !el.classList.contains('codex-toggle-btn'))
      .filter(el => el.closest(ctxSelector))
      .filter(el => {
        const t = getLabelText(el);
        // Match your snippet: nested span with text "Confirm merge"
        const hasConfirmMerge = t.includes('confirm') && t.includes('merge');
        // Also accept GitHub merge button classes when present
        const classHit = ['js-merge-commit-button','js-merge-squash-button','js-merge-rebase-button','js-merge-box-button']
          .some(cls => el.classList && el.classList.contains(cls));
        return hasConfirmMerge || classHit;
      });

    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  function autoConfirmMergeTick(){
    if (!autoConfirmMerge) return;
    const now = Date.now();
    if (now - lastMergeClick < 3000) return; // debounce
    const btn = findConfirmMergeButton();
    if (btn) {
      lastMergeClick = now;
      btn.click();
    }
  }

  // ---------- Comment quickbar (presets) ----------
  function findSubmitButton(form) {
    const all = Array.from(
      form.querySelectorAll('button[type="submit"], input[type="submit"]').values()
    ).filter(el => !el.disabled && el.offsetParent !== null);

    const getLabel = (el) => (
      (el.getAttribute('aria-label') || '') + ' ' +
      ((('value' in el ? el.value : '') || '') + ' ' + (el.textContent || ''))
    ).trim().toLowerCase();

    // Exclude dangerous/non-comment actions
    const safe = all.filter(el => !/(close|reopen|merge|convert|discard|delete|cancel)/.test(getLabel(el)));

    // Prefer buttons that look like comment actions
    const commenty = safe.filter(el => {
      const label = getLabel(el);
      return /(comment|add\s+single\s+comment|save\s+comment|reply|send)/.test(label)
          || el.classList.contains('js-comment-and-button')
          || el.name === 'comment_and_button';
    });

    const last = (arr) => (arr.length ? arr[arr.length - 1] : null);
    return last(commenty) || last(safe) || last(all) || null;
  }

  function findCommentTextarea(form) {
    return (
      form.querySelector('textarea#new_comment_field') ||
      form.querySelector('textarea[name="comment[body]"]') ||
      form.querySelector('textarea[name*="[body]"]') ||
      form.querySelector('textarea[aria-label="Comment body"]') ||
      form.querySelector('textarea')
    );
  }

  function buildQuickbar(form, textarea) {
    if (!form || !textarea) return null;
    if (form.dataset.codexQuickbarAttached === '1') return null;

    const bar = document.createElement('div');
    bar.className = 'codex-quickbar';

    const mkBtn = (key, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn codex-btn-' + key;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        textarea.focus();
        textarea.value = PHRASES[key];
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        const submit = findSubmitButton(form);
        if (submit) submit.click();
        else { try { form.submit(); } catch (_) {} }
      });
      return btn;
    };

    bar.appendChild(mkBtn('fix', '⚙️ @codex fix comments'));
    bar.appendChild(mkBtn('review', '🧐 @codex review'));
    bar.appendChild(mkBtn('go', '🚀 @codex go go go'));

    // Place OUTSIDE the bordered editor, directly before the whole editor wrapper.
    try {
      const wrapper = textarea.closest('.js-previewable-comment-form, .comment-form, .review-comment, .js-inline-comment-form, .timeline-comment, .discussion-item') || textarea.parentElement || form;
      if (wrapper && wrapper.parentElement) {
        wrapper.parentElement.insertBefore(bar, wrapper);
      } else {
        const toolbar = form.querySelector('.markdown-toolbar');
        if (toolbar && toolbar.parentElement) {
          toolbar.parentElement.insertBefore(bar, toolbar);
        } else if (textarea.parentElement) {
          textarea.parentElement.insertBefore(bar, textarea);
        } else {
          form.prepend(bar);
        }
      }
    } catch (e) {
      form.prepend(bar);
    }

    form.dataset.codexQuickbarAttached = '1';
    return bar;
  }

  function enhanceAll() {
    const forms = document.querySelectorAll([
      'form.js-new-comment-form',
      'form.js-inline-comment-form',
      'form.js-resolvable-thread-contents',
      'form[aria-label^="Comment"]',
      'form[aria-label^="Start a review"]',
      'form[aria-label^="Reply"]'
    ].join(','));

    forms.forEach((form) => {
      const textarea = findCommentTextarea(form);
      if (!textarea) return;
      const plausible = textarea.closest('.js-previewable-comment-form, .js-comment, .js-discussion, .comment-form, .review-comment') ||
                        textarea.matches('#new_comment_field, .comment-form-textarea, textarea[name*="[body]"]');
      if (!plausible) return;
      buildQuickbar(form, textarea);
    });
  }

  // ---------- Init ----------
  buildAutoConfirmToggle();
  setInterval(autoConfirmMergeTick, 800); // keep running

  enhanceAll();
  const mo = new MutationObserver(() => enhanceAll());
  mo.observe(document.body, { childList: true, subtree: true });
})();
