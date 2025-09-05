// ==UserScript==
// @name         GitHub Codex Quick Comments
// @namespace    https://supermarsx.github.io/userscripts
// @version      1.2.0
// @description  Add quick-action buttons on GitHub comment boxes to auto-fill and submit: "@codex fix comments", "@codex review", "@codex go go go".
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

  /**
   * Minimal CSS to make the toolbar look native-ish without clashing.
   */
  const STYLE = `
    .codex-quickbar { display:flex; gap:6px; flex-wrap:wrap; margin:6px 0 2px; align-items:center; }
    .codex-quickbar button { border:1px solid var(--borderColor-muted, #30363d); background:var(--bgColor-default, #0d1117); color:var(--fgColor-default, #c9d1d9); padding:4px 8px; border-radius:6px; font-size:12px; line-height:18px; cursor:pointer; }
    .codex-quickbar button:hover { background:var(--bgColor-muted, #161b22); }
    .codex-quickbar .codex-label { opacity:0.75; font-size:12px; margin-right:4px; }
    /* Floating toggle for auto-confirm merge */
    .codex-toggle { position:fixed; left:12px; bottom:12px; z-index:9999; display:flex; gap:8px; align-items:center; background:var(--bgColor-default, #0d1117); border:1px solid var(--borderColor-muted, #30363d); padding:6px 10px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,.3); }
    .codex-toggle button { border:1px solid var(--borderColor-muted, #30363d); background:transparent; color:var(--fgColor-default, #c9d1d9); padding:4px 8px; border-radius:6px; font-size:12px; line-height:18px; cursor:pointer; }
    .codex-toggle button:hover { background:var(--bgColor-muted, #161b22); }
  `;

  const styleTag = document.createElement('style');
  styleTag.textContent = STYLE;
  document.documentElement.appendChild(styleTag);

  // === Auto Confirm Merge toggle + logic ===
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

  function getLabelText(el){
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const val  = (('value' in el ? el.value : '') || '').toLowerCase();
    const deep = (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return `${aria} ${val} ${deep}`.trim();
  }
  function isVisible(el){
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }

  function findConfirmMergeButton(){
    // Search common merge containers and any open dialog
    const scopes = document.querySelectorAll([
      '#partial-pull-merging',
      '.js-merge-pr',
      '.merge-branch-action',
      'form[action*="/merge"]',
      '.details-dialog[open]',
      'dialog[open]'
    ].join(','));

    const pool = new Set();
    scopes.forEach(sc => sc.querySelectorAll('button, input[type="submit"]').forEach(el => pool.add(el)));
    if (!pool.size) {
      // Fallback global scan
      document.querySelectorAll('button, input[type="submit"]').forEach(el => pool.add(el));
    }

    const candidates = Array.from(pool)
      .filter(el => !el.disabled && isVisible(el))
      .filter(el => {
        const t = getLabelText(el);
        const hasConfirmMerge = t.includes('confirm') && t.includes('merge');
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

  // Initialize toggle and periodic checker
  buildAutoConfirmToggle();
  setInterval(autoConfirmMergeTick, 800);

  /**
   * Try to find the primary submit button for a given form.
   */
  function findSubmitButton(form) {
    // Collect all visible, enabled submit buttons within the form
    const all = Array.from(
      form.querySelectorAll('button[type="submit"], input[type="submit"]').values()
    ).filter(el => !el.disabled && el.offsetParent !== null);

    const getLabel = (el) => (
      (el.getAttribute('aria-label') || '') + ' ' +
      (('value' in el ? el.value : '') || el.textContent || '')
    ).trim().toLowerCase();

    // Exclude dangerous/non-comment actions (close, merge, delete, etc.)
    const safe = all.filter(el => {
      const label = getLabel(el);
      return !(/close|reopen|merge|convert|discard|delete|cancel/.test(label));
    });

    // Prefer buttons that look like comment actions
    const commenty = safe.filter(el => {
      const label = getLabel(el);
      return (
        /comment|reply|send/.test(label) ||
        label.includes('add single comment') ||
        label.includes('save comment') ||
        el.classList.contains('js-comment-and-button') ||
        el.name === 'comment_and_button'
      );
    });

    // Helper to return the last element in a list (user requested: "always click the last button")
    const last = (arr) => (arr.length ? arr[arr.length - 1] : null);

    return last(commenty) || last(safe) || last(all) || null;
  }

  /**
   * Locate the comment textarea inside a form.
   * Handles issue/PR comments, line review comments, commit comments, etc.
   */
  function findCommentTextarea(form) {
    return (
      form.querySelector('textarea#new_comment_field') ||
      form.querySelector('textarea[name="comment[body]"]') ||
      form.querySelector('textarea[name*="[body]"]') ||
      form.querySelector('textarea[aria-label="Comment body"]') ||
      form.querySelector('textarea')
    );
  }

  /**
   * Build a quickbar for a given form/textarea pair.
   */
  function buildQuickbar(form, textarea) {
    if (!form || !textarea) return null;

    // Prevent double-injection
    if (form.dataset.codexQuickbarAttached === '1') return null;

    const bar = document.createElement('div');
    bar.className = 'codex-quickbar';

    const mkBtn = (key, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn codex-btn-${key}`;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        // Fill
        textarea.focus();
        textarea.value = PHRASES[key];
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        // Submit
        const submit = findSubmitButton(form);
        if (submit) {
          submit.click();
        } else {
          // Fallback: try form.submit() (may be blocked by GitHub)
          try { form.submit(); } catch (_) {}
        }
      });
      return btn;
    };

    bar.appendChild(mkBtn('fix', '⚙️ @codex fix comments'));
    bar.appendChild(mkBtn('review', '🧐 @codex review'));
    bar.appendChild(mkBtn('go', '🚀 @codex go go go'));

    // Place the bar OUTSIDE the bordered editor, directly before the whole editor wrapper.
    try {
      // Prefer a wrapper that encloses toolbar + textarea so our bar sits *above* the input box border.
      const wrapper = textarea.closest('.js-previewable-comment-form, .comment-form, .review-comment, .js-inline-comment-form, .timeline-comment, .discussion-item') || textarea.parentElement || form;
      if (wrapper && wrapper.parentElement) {
        wrapper.parentElement.insertBefore(bar, wrapper);
      } else {
        // If no wrapper parent, fall back to placing after toolbar, then before textarea.
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

  /**
   * Enhance all visible comment forms.
   */
  function enhanceAll() {
    const forms = document.querySelectorAll(
      [
        'form.js-new-comment-form',
        'form.js-inline-comment-form',
        'form.js-resolvable-thread-contents',
        'form[aria-label^="Comment"]',
        'form[aria-label^="Start a review"]',
        'form[aria-label^="Reply"]',
        'form'
      ].join(',')
    );

    forms.forEach((form) => {
      const textarea = findCommentTextarea(form);
      if (!textarea) return;

      // Heuristic: only enhance forms that look like comment boxes (skip search forms, filters, etc.)
      const plausible = textarea.closest('.js-previewable-comment-form, .js-comment, .js-discussion, .comment-form, .review-comment') ||
                        textarea.matches('#new_comment_field, .comment-form-textarea, textarea[name*="[body]"]');
      if (!plausible) return;

      buildQuickbar(form, textarea);
    });
  }

  // Initial pass
  enhanceAll();

  // Observe DOM for dynamically added comment forms (common on GitHub)
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches && (node.matches('form') || node.querySelector?.('form'))) {
          enhanceAll();
        }
      }
    }
  });

  mo.observe(document.body, { childList: true, subtree: true });
})();
