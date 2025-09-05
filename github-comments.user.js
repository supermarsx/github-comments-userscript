// ==UserScript==
// @name         GitHub Codex Quick Comments
// @namespace    https://github.com/
// @version      1.0.0
// @description  Add quick-action buttons on GitHub comment boxes to auto-fill and submit: "@codex fix comments", "@codex review", "@codex go go go".
// @author       Mariana
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
  `;

  const styleTag = document.createElement('style');
  styleTag.textContent = STYLE;
  document.documentElement.appendChild(styleTag);

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
