/* Responsive DOM presentation. No API, data, session or screening state changes. */
(() => {
  'use strict';
  const media = matchMedia('(max-width: 650px)');
  const byId = id => document.getElementById(id);
  const primary = {
    watchlistBody: ['股票', '漲跌幅', '技術分數', '狀態'],
    buyCandidatesBody: ['股票', '收盤價', '技術分數', '狀態'],
    sellCandidatesBody: ['股票', '收盤價', '技術分數', '狀態'],
    portfolioBody: ['股票', '股數', '現價', '未實現損益', '技術狀態'],
    screenerResultBody: ['股票', '收盤價', '漲跌幅', '成交量']
  };
  const toolIds = ['btnUpdateDaily', 'btnRunDerived', 'btnBackfillHistory', 'btnRefreshVersion', 'btnRefreshScreenerDaily', 'btnBootstrapScreenerData'];
  let queued = false, awaitingResults = false, resultChanged = false, previousTitle = '';
  let sheetWasOpen = false, sheetOpener = null;
  function setText(el, value) { if (el.textContent !== value) el.textContent = value; }
  function collapse(value) {
    const builder = document.querySelector('.screener-builder');
    builder?.classList.toggle('mobile-conditions-collapsed', value);
    byId('mobileConditionToggle')?.setAttribute('aria-expanded', String(!value));
  }
  function enhanceRows() {
    for (const [id, labels] of Object.entries(primary)) {
      for (const row of byId(id)?.rows || []) {
        if (!row.querySelector('td[data-label]')) continue;
        row.classList.add('mobile-compact-row');
        for (const cell of row.cells) {
          if (cell.dataset.label) cell.classList.toggle('mobile-row-secondary', !labels.includes(cell.dataset.label));
        }
        if (row.querySelector('.mobile-row-details')) continue;
        const cell = row.insertCell();
        cell.className = 'mobile-row-details';
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.mobileDetails = '';
        button.textContent = '詳細 ▾'; button.setAttribute('aria-expanded', 'false');
        const name = row.querySelector('[data-label="股票"]')?.textContent.trim() || '股票';
        button.setAttribute('aria-label', name + ' 詳細資料');
        cell.append(button);
      }
    }
  }
  function enhanceHeader() {
    let dateLabel = byId('mobileHeaderDate');
    if (!dateLabel) {
      dateLabel = document.createElement('div'); dateLabel.id = 'mobileHeaderDate';
      dateLabel.className = 'mobile-header-date'; byId('pageTitle').after(dateLabel);
    }
    const page = document.querySelector('.page.active');
    const sources = [page?.querySelector('#candidateStatus, #screenerMetaStatus'), byId('dashboardUpdateStatus')];
    const date = sources.map(el => el?.textContent.match(/\d{4}-\d{2}-\d{2}/)?.[0]).find(Boolean);
    setText(dateLabel, date || '');
    document.querySelector('.topbar').classList.toggle('mobile-date-ready', !!date);
    const status = byId('apiStatus');
    // Hide only known success/idle notices. Errors and background progress stay visible.
    status.classList.toggle('mobile-routine-status', ['已設定 API', 'API 已連線', '候選清單已更新', 'v11 資料已更新', 'API 連線成功'].includes(status.textContent.trim()));
    const bell = byId('btnNotificationCenter');
    if (!bell.querySelector('.mobile-notification-icon')) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'mobile-notification-icon'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
      bell.prepend(icon);
    }
    const title = byId('pageTitle').textContent;
    if (previousTitle && previousTitle !== title) window.scrollTo({ top: 0, behavior: 'instant' });
    previousTitle = title;
  }
  function enhanceConditions() {
    let toggle = byId('mobileConditionToggle');
    if (!toggle) {
      toggle = document.createElement('button'); toggle.id = 'mobileConditionToggle'; toggle.type = 'button';
      toggle.className = 'mobile-condition-toggle'; toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-controls', 'screenerConditionBar mobileScreenerSort');
      document.querySelector('.screener-run-bar').id = 'mobileScreenerSort';
      document.querySelector('.screener-builder .panel-header').prepend(toggle);
    }
    const count = byId('screenerConditionBar').querySelectorAll('.screener-condition-card').length;
    if (awaitingResults && resultChanged) {
      const body = byId('screenerResultBody');
      if (!/尚未執行選股|載入中/.test(body.textContent)) {
        awaitingResults = false; collapse(true);
        document.querySelector('.screener-results-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }
    // Validation/transport failures return the original button to idle without new rows.
    // Do not let a later sort or page change consume an unsuccessful query's intent.
    if (awaitingResults && !byId('btnStartScreener').disabled) awaitingResults = false;
    setText(toggle, '條件與排序（' + count + '）' + (toggle.getAttribute('aria-expanded') === 'true' ? ' ▴' : ' ▾'));
    resultChanged = false;
  }
  function enhanceMore() {
    const links = byId('mobileMoreLinks');
    if (!links || !links.children.length) return;
    for (const id of toolIds) {
      const source = byId(id);
      if (!source) continue;
      let proxy = links.querySelector('[data-mobile-tool="' + id + '"]');
      if (!proxy) {
        proxy = document.createElement('button'); proxy.type = 'button'; proxy.dataset.mobileTool = id; links.append(proxy);
      }
      if (proxy.hidden !== source.hidden) proxy.hidden = source.hidden;
      if (proxy.disabled !== source.disabled) proxy.disabled = source.disabled;
      setText(proxy, source.textContent.trim());
    }
    if (!links.querySelector('[data-action="logout"]')) {
      const logout = document.createElement('button'); logout.type = 'button'; logout.dataset.action = 'logout'; logout.dataset.mobileAdded = ''; logout.textContent = '登出'; links.append(logout);
    }
    const sheet = byId('mobileMoreSheet');
    const open = !sheet.hidden;
    if (open && !sheetWasOpen) {
      sheetOpener = byId('btnMobileMore');
      sheet.querySelector('.mobile-more-header button').focus();
    } else if (!open && sheetWasOpen && (sheet.contains(document.activeElement) || document.activeElement === document.body)) sheetOpener?.focus();
    sheetWasOpen = open;
  }
  function restore() {
    document.querySelectorAll('.mobile-row-details, #mobileHeaderDate, #mobileConditionToggle, .mobile-notification-icon, [data-mobile-tool], [data-mobile-added]').forEach(el => el.remove());
    document.querySelectorAll('.mobile-compact-row, .mobile-expanded, .mobile-row-secondary, .mobile-date-ready, .mobile-routine-status, .mobile-conditions-collapsed').forEach(el => el.classList.remove('mobile-compact-row', 'mobile-expanded', 'mobile-row-secondary', 'mobile-date-ready', 'mobile-routine-status', 'mobile-conditions-collapsed'));
    document.querySelector('.screener-run-bar')?.removeAttribute('id');
    if (!byId('mobileMoreSheet').hidden) window.closeMobileMore?.();
    awaitingResults = false; previousTitle = ''; sheetWasOpen = false;
  }
  function refresh() {
    queued = false;
    if (!media.matches) return;
    enhanceHeader(); enhanceRows(); enhanceConditions(); enhanceMore();
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(refresh); } }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target === byId('screenerResultBody') && record.type === 'childList')) resultChanged = true;
    schedule();
  });
  observer.observe(document.querySelector('.main'), { childList: true, characterData: true, subtree: true });
  observer.observe(byId('mobileMoreSheet'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  for (const id of toolIds) if (byId(id)) observer.observe(byId(id), { attributes: true, attributeFilter: ['hidden', 'disabled'] });
  observer.observe(byId('btnStartScreener'), { attributes: true, attributeFilter: ['disabled'] });
  document.addEventListener('click', event => {
    if (!media.matches) return;
    const details = event.target.closest('[data-mobile-details]');
    if (details) {
      const expanded = details.closest('tr').classList.toggle('mobile-expanded');
      details.setAttribute('aria-expanded', String(expanded)); setText(details, expanded ? '收合 ▴' : '詳細 ▾'); return;
    }
    if (event.target.closest('#mobileConditionToggle')) { collapse(byId('mobileConditionToggle').getAttribute('aria-expanded') === 'true'); schedule(); }
    if (event.target.closest('#btnOpenScreenerConditions')) { collapse(false); schedule(); }
    if (event.target.closest('#btnStartScreener') && !byId('btnStartScreener').disabled) awaitingResults = true;
    const proxy = event.target.closest('[data-mobile-tool]');
    if (proxy) { const source = byId(proxy.dataset.mobileTool); window.closeMobileMore?.(); if (source && !source.hidden && !source.disabled) source.click(); }
  }, true);
  // Existing nav binding treats More as a route. Keep the current page when opening it.
  byId('btnMobileMore')?.addEventListener('click', event => {
    if (media.matches) { event.stopImmediatePropagation(); window.openMobileMore?.(); schedule(); }
  }, true);
  document.addEventListener('keydown', event => {
    const sheet = byId('mobileMoreSheet');
    if (!media.matches || sheet.hidden || event.key !== 'Tab') return;
    const buttons = [...sheet.querySelectorAll('.mobile-more-panel button')].filter(el => !el.hidden && !el.disabled && el.getClientRects().length);
    if (!buttons.length) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  media.addEventListener('change', () => { if (!media.matches) restore(); else schedule(); });
  schedule();
})();
