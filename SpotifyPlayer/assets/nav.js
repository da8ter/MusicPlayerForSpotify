/* Musikplayer für Spotify – untere Reiterleiste und „Mehr“-Menü, übernommen aus der
   SymDo-Web-App (tabLeisteAnpassen, openMenu): schwebende Glas-Kapsel, Symbol über Beschriftung.
   Die Leiste passt sich in drei Stufen dem Platz an, jede erst, wenn die vorige nicht reicht:
   1. Symbol und Beschriftung – so breit wie ihr Inhalt, mindestens die halbe, höchstens die Inhaltsbreite.
   2. Nur Symbole (Klasse nur-symbole).
   3. Von rechts her wandern Knöpfe hinter „Mehr“ (Klasse ueberlauf); der aktive Bereich leuchtet am
      Mehr-Knopf, wenn sein eigener Knopf verborgen ist. */
(function () {
  'use strict';
  const svg = window.AMPIcons.svg;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nav = () => document.getElementById('tabs');

  /** items: [{ key, label }], active: key oder '', onSelect(key), moreLabel */
  function render(items, active, onSelect, moreLabel) {
    const bar = nav();
    bar.innerHTML = '';
    items.forEach(item => {
      const b = document.createElement('button');
      b.id = 'tab-' + item.key;
      b.className = item.key === active ? 'active' : '';
      b.title = item.label;
      b.innerHTML = svg(item.key, 'tab-icon') + '<span>' + esc(item.label) + '</span>';
      b.onclick = () => onSelect(item.key);
      bar.appendChild(b);
    });
    const more = document.createElement('button');
    more.id = 'tab-mehr';
    more.style.display = 'none';
    more.title = moreLabel;
    more.innerHTML = svg('more', 'tab-icon') + '<span>' + esc(moreLabel) + '</span>';
    more.onclick = () => moreMenu(more);
    bar.appendChild(more);
    // Ein einziger Bereich: die Leiste wäre ein Knopf ohne Wahl. Dann fällt sie weg.
    document.documentElement.classList.toggle('no-tabs', items.length <= 1);
    fit();
  }

  // Bedarf = breitester Knopf mal Anzahl (die Knöpfe sind gleich breit, flex: 1) plus Polster und
  // Rand der Leiste. Die Leiste bekommt ihn als Breite; Mindest- und Höchstmaß (CSS) deckeln ihn,
  // und ob er passte, sagt die Breite, die dabei herauskam.
  function fit() {
    const bar = nav();
    const more = document.getElementById('tab-mehr');
    if (!bar || !more || document.documentElement.classList.contains('no-tabs')) return;
    const buttons = Array.from(bar.querySelectorAll('button')).filter(b => b !== more);
    bar.classList.remove('nur-symbole');
    buttons.forEach(b => b.classList.remove('ueberlauf'));
    more.style.display = 'none';
    const fits = () => {
      const visible = buttons.filter(b => !b.classList.contains('ueberlauf'));
      if (more.style.display !== 'none') visible.push(more);
      let widest = 0;
      for (const b of visible) {
        const text = b.querySelector('span');
        const icon = b.querySelector('svg');
        widest = Math.max(widest, text && text.offsetParent !== null ? text.scrollWidth : 0, icon ? icon.getBoundingClientRect().width : 0);
      }
      const cs = getComputedStyle(bar);
      const frame = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      // Luft je Knopf: 8px zwischen Wörtern; nur Symbole brauchen mehr, sonst stehen sie wie eine Kette.
      const air = bar.classList.contains('nur-symbole') ? 23 : 8;
      const need = Math.ceil(visible.length * (widest + air) + frame);
      bar.style.width = need + 'px';
      return bar.offsetWidth >= need - 0.5;
    };
    if (fits()) { markMore(); return; }
    bar.classList.add('nur-symbole');
    if (fits()) { markMore(); return; }
    more.style.display = '';
    const shown = buttons.slice();
    // Von rechts her – aber mindestens ein Knopf bleibt neben „Mehr“ stehen.
    while (shown.length > 1 && !fits()) shown.pop().classList.add('ueberlauf');
    markMore();
  }

  function markMore() {
    const more = document.getElementById('tab-mehr');
    if (more) more.classList.toggle('active', !!nav().querySelector('button.active.ueberlauf'));
  }

  // Das Menü hinter „Mehr“: die verborgenen Knöpfe mit Symbol und Namen; der Eintrag klickt den Knopf selbst.
  function moreMenu(anchor) {
    const entries = [];
    nav().querySelectorAll('button.ueberlauf').forEach(b => {
      entries.push({ label: b.title, icon: b.id.replace('tab-', ''), checked: b.classList.contains('active'), onClick: () => b.click() });
    });
    if (entries.length) openMenu(anchor, entries);
  }

  // ── Menü-Popover (wie openMenu der Web-App) ──
  let menuCloser = null;
  let menuAnchor = null;
  function closeMenu() {
    const pop = document.getElementById('menuPop');
    if (pop) pop.remove();
    menuAnchor = null;
    if (menuCloser) {
      document.removeEventListener('mousedown', menuCloser, true);
      document.removeEventListener('touchstart', menuCloser, true);
      menuCloser = null;
    }
  }
  function openMenu(anchor, entries) {
    // Zweiter Klick auf denselben Knopf schließt das Menü wieder.
    if (menuAnchor === anchor && document.getElementById('menuPop')) { closeMenu(); return; }
    closeMenu();
    const pop = document.createElement('div');
    pop.id = 'menuPop';
    pop.className = 'menu-pop open';
    for (const entry of entries) {
      const btn = document.createElement('button');
      btn.innerHTML = (entry.icon ? svg(entry.icon, 'tab-icon') : '') + esc(entry.label) + (entry.checked ? svg('check', 'check') : '');
      btn.addEventListener('click', () => { closeMenu(); entry.onClick(); });
      pop.appendChild(btn);
    }
    document.body.appendChild(pop);
    if (window.AMPScroll) window.AMPScroll.bind(pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.maxWidth = Math.min(280, window.innerWidth - 16) + 'px';
    // An der Leiste (unten) klappt das Menü nach OBEN auf; verankert wird die Unterkante über der Leiste.
    const bar = anchor.closest ? anchor.closest('.tabnav') : null;
    if (bar) {
      pop.style.top = 'auto';
      pop.style.bottom = (window.innerHeight - bar.getBoundingClientRect().top + 6) + 'px';
    } else {
      pop.style.top = Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 10) + 'px';
    }
    pop.style.left = Math.max(8, Math.min(rect.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    menuAnchor = anchor;
    menuCloser = e => {
      if (pop.contains(e.target)) return;
      if (anchor && anchor.contains(e.target)) return; // Umschalten macht der Klick
      closeMenu();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', menuCloser, true);
      document.addEventListener('touchstart', menuCloser, true);
    }, 0);
  }

  // ── Seitenleiste (breite Kacheln, wie die Musik-App auf dem iPad): Gruppen mit Überschrift ──
  /** groups: [{ title?, items: [{ key, label, icon }] }] */
  function sidebar(container, groups, active, onSelect) {
    container.innerHTML = '';
    groups.forEach(group => {
      if (group.title) {
        const h = document.createElement('div');
        h.className = 'side-head';
        h.textContent = group.title;
        container.appendChild(h);
      }
      group.items.forEach(item => {
        const b = document.createElement('button');
        b.className = 'side-item' + (item.key === active ? ' active' : '');
        b.title = item.label;
        b.innerHTML = svg(item.icon, 'side-icon') + '<span>' + esc(item.label) + '</span>';
        b.onclick = () => onSelect(item.key);
        container.appendChild(b);
      });
    });
  }

  let fitRaf = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fit); });

  window.AMPNav = { render, fit, sidebar };
})();
