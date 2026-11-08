// SPDX-License-Identifier: GPL-3.0-or-later

// Wersja karty - podbijaj przy każdej zmianie pliku, żeby w konsoli przeglądarki
// (F12) od razu widać było, czy Home Assistant załadował nowy plik, a nie cache.
const VULTRON_CARD_VERSION = '7.2.1-h3xen.1';

class VultronPlanCard extends HTMLElement {
  constructor() {
    super();
    this._weekOffset = 0;
    this._autoShiftedToNext = false;
    this._lineUpdater = null;

    // Cache stanu - render tylko przy zmianie danych
    this._cachedPlanState = null;
    this._cachedFreqState = null;
    this._cachedWeekOffset = null;
  }

  // Zabezpieczenie przed atakami XSS
  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Stały kolor "własnych zajęć" ucznia, liczony z identyfikatora encji.
  _customLessonColor() {
    if (this._customColorCache) return this._customColorCache;
    const PALETTE = ['#00897b', '#3f51b5', '#c2185b', '#6d4c41', '#0097a7', '#827717', '#ad1457', '#512da8'];
    const baseEntity = (this.config?.entity || '').replace(/_(prev|curr|next)$/, '');
    const slug = baseEntity.replace('sensor.vultron_plan_', '') || 'default';
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
      hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
    }
    this._customColorCache = PALETTE[hash % PALETTE.length];
    return this._customColorCache;
  }

  set hass(hass) {
    this._hass = hass;

    // 1. Inicjalizacja DOM i zdarzeń (raz)
    if (!this.content) {
      this.innerHTML = `
        <style>
          /* ============================================================
             WYGLĄD KARTY PLANU LEKCJI - zmieniaj wartości tutaj.
             Zmienne można też nadpisać w YAML-u karty (card-mod):
               card_mod:
                 style: |
                   :host, vultron-card { --vp-time-col-width: 100px; }
             ============================================================ */
          vultron-card {
            /* Skala CAŁEJ tabeli: 1 = bez zmian, 0.8 = o 20% mniejsza, 1.2 = większa */
            --vp-scale: 1;
            /* Nagłówek karty (nazwa ucznia + tydzień + strzałki) */
            --vp-head-pad-top: 1px;          /* odstęp nad nagłówkiem (było 16px) */
            --vp-head-pad-bottom: 1px;       /* odstęp pod nagłówkiem, nad linią (było 8px) */
            --vp-head-gap: 6px;              /* odstęp między linią a tabelą (było 12px) */
            --vp-nav-size: 14px;             /* wielkość strzałek poprzedni/następny tydzień (było 32px) */
            --vp-font-student: 1em;          /* nazwa ucznia (było 1.1em) */
            /* Rozmiary */
            --vp-table-min-width: 650px;   /* minimalna szerokość tabeli (poniżej - przewijanie) */
            --vp-time-col-width: 85px;       /* szerokość kolumny GODZINA (i żółtej etykiety czasu) */
            --vp-header-padding: 0px;       /* odstęp w nagłówkach dni */
            --vp-time-cell-padding: 10px 5px;/* odstęp w komórce godziny */
            --vp-cell-padding: 4px;          /* odstęp w komórce dnia */
            --vp-lesson-padding: 0px;        /* odstęp wewnątrz kafelka lekcji */
            --vp-lesson-min-height: 0px;    /* minimalna wysokość kafelka lekcji */
            /* Czcionki */
            --vp-font-time: 0.8em;           /* godziny lekcji */
            --vp-font-lesson: 0.9em;         /* nazwa lekcji */
            --vp-font-meta: 0.72em;          /* sala i nauczyciel */
            --vp-font-pill: 0.65em;          /* plakietki statusu (Odwołane itd.) */
            /* Kolory */
            --vp-border: 1px solid var(--divider-color);
            --vp-now-line: #ffff00;          /* kreska aktualnej godziny */
            --vp-odwol: #d32f2f;
            --vp-zwol: #388e3c;
            --vp-zast: #ef6c00;
            --vp-przen: #1976d2;
            --vp-nieob: #7b1fa2;
            --vp-odwol-bg: transparent;
            --vp-zwol-bg: rgba(76, 175, 80, 0.08);
            --vp-zast-bg: rgba(255, 165, 0, 0.12);
            --vp-przen-bg: rgba(33, 150, 243, 0.1);
            --vp-nieob-bg: rgba(156, 39, 176, 0.1);
          }

          /* Nagłówek karty */
          vultron-card .vp-wrap { padding: var(--vp-head-pad-top) 16px 16px; position: relative; }
          vultron-card .vp-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--vp-head-gap); border-bottom: 2px solid var(--primary-color); padding-bottom: var(--vp-head-pad-bottom); }
          vultron-card .vp-nav { --mdc-icon-button-size: var(--vp-nav-size); cursor: pointer; color: var(--primary-color); }
          vultron-card .vp-title { text-align: center; flex: 1; line-height: 1.2; }
          vultron-card .vp-student { font-size: var(--vp-font-student); font-weight: 500; color: #00bcd4; text-align: center; }
          vultron-card .vp-week { font-weight: bold; font-size: 0.8em; color: var(--primary-color); text-transform: uppercase; letter-spacing: 1px; margin-top: 0; }

          /* Tabela */
          vultron-card .vp-scroll { zoom: var(--vp-scale); overflow-x: auto;border: var(--vp-border); border-radius: 8px; }
          vultron-card .vp-box { position: relative; min-width: var(--vp-table-min-width); width: 100%; }
          vultron-card .vp-table { width: 100%; border-collapse: collapse; table-layout: fixed; min-width: var(--vp-table-min-width); border: none; }
          vultron-card .vp-table thead tr { background: var(--secondary-background-color); }
          vultron-card .vp-th { padding: var(--vp-header-padding); border: var(--vp-border); }
          vultron-card .vp-th-time { width: var(--vp-time-col-width); font-size: 0.8em; }
          vultron-card .day-header { background: transparent; }
          vultron-card .day-header.vp-today { background: rgba(var(--rgb-primary-color), 0.15); border-bottom: 3px solid var(--accent-color); }
          vultron-card .vp-date { font-weight: bold; color: var(--primary-color); background: var(--secondary-background-color); padding: 2px 6px; border-radius: 6px; font-size: 0.78em; white-space: nowrap; }

          /* Kreska aktualnej godziny */
          vultron-card .vp-line { display: none; position: absolute; left: var(--vp-time-col-width); right: 0; height: 2px; background: var(--vp-now-line); z-index: 1000; pointer-events: none; box-shadow: 0 0 4px rgba(255, 255, 0, 0.6); }
          vultron-card .vp-line-label { position: absolute; left: calc(-1 * var(--vp-time-col-width)); top: -10px; width: var(--vp-time-col-width); height: 20px; background: var(--vp-now-line); color: #000 !important; font-size: 12px; font-weight: 900; text-align: center; line-height: 20px; border-radius: 0 10px 10px 0; box-shadow: 2px 0 5px rgba(0,0,0,0.3); z-index: 1001; }

          /* Komórki */
          vultron-card .vp-empty { text-align: center; padding: 20px; }
          vultron-card .vp-time { padding: var(--vp-time-cell-padding); text-align: center; border: var(--vp-border); font-size: var(--vp-font-time); background: var(--card-background-color); color: inherit; font-weight: bold; }
          vultron-card .vp-time.vp-now { background: var(--accent-color); color: white; }
          vultron-card .vp-cell { padding: var(--vp-cell-padding); border: var(--vp-border); vertical-align: top; position: relative; background: transparent; }
          vultron-card .vp-cell.vp-today { background: rgba(var(--rgb-primary-color), 0.05); }
          vultron-card .vp-cell.vp-now { box-shadow: inset 0 0 0 2px var(--accent-color); z-index: 5; background: rgba(var(--rgb-accent-color), 0.1) !important; }
          vultron-card .vp-now-tag { position: absolute; top: 0; right: 0; font-size: 0.5em; background: var(--accent-color); color: white; padding: 1px 4px; font-weight: bold; border-bottom-left-radius: 4px; z-index: 6; }

          /* Dzień wolny */
          vultron-card .vp-free { padding: var(--vp-cell-padding); border: var(--vp-border); vertical-align: middle; text-align: center; background: rgba(var(--rgb-primary-color), 0.02); }
          vultron-card .vp-free.vp-today { background: rgba(var(--rgb-primary-color), 0.05); }
          vultron-card .vp-free.vp-cur { box-shadow: inset 0 0 0 2px var(--primary-color); z-index: 5; }
          vultron-card .vp-free-box { font-weight: bold; color: var(--primary-color); font-size: 0.9em; line-height: 1.3; padding: 12px 6px; border-radius: 8px; background: rgba(var(--rgb-primary-color), 0.1); border: 1px dashed var(--primary-color); }

          /* Kafelek lekcji */
          vultron-card .vp-lesson { position: relative; min-height: var(--vp-lesson-min-height); padding: var(--vp-lesson-padding); background: transparent; border-radius: 4px; }
          vultron-card .vp-lesson + .vp-lesson { border-top: 1px dashed var(--divider-color); margin-top: 5px; }
          vultron-card .vp-lesson-name { font-weight: 600; font-size: var(--vp-font-lesson); line-height: 1.2; }
          vultron-card .vp-lesson-meta { font-size: var(--vp-font-meta); opacity: 0.7; margin-top: 1px; clear: both; }
          /* Prawy górny róg kafelka: znacznik frekwencji + plakietka statusu.
             float - tekst lekcji zawija się pod nim i nie nachodzi na plakietkę. */
          vultron-card .vp-corner { float: right; display: flex; align-items: center; gap: 4px; margin: 0 0 2px 4px; }
          vultron-card .vp-lesson--odwol { background: var(--vp-odwol-bg); }
          vultron-card .vp-lesson--odwol .vp-lesson-name { text-decoration: line-through; opacity: 0.5; }
          vultron-card .vp-lesson--zwol { background: var(--vp-zwol-bg); }
          vultron-card .vp-lesson--zwol .vp-lesson-name { text-decoration: line-through; opacity: 0.6; }
          vultron-card .vp-lesson--zast { background: var(--vp-zast-bg); }
          vultron-card .vp-lesson--przen { background: var(--vp-przen-bg); }
          vultron-card .vp-lesson--nieob { background: var(--vp-nieob-bg); }

          /* Plakietki statusu */
          vultron-card .vp-pill { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: var(--vp-font-pill); font-weight: 900; color: white; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.5px; }
          vultron-card .vp-pill--odwol { background: var(--vp-odwol); }
          vultron-card .vp-pill--zwol { background: var(--vp-zwol); }
          vultron-card .vp-pill--zast { background: var(--vp-zast); }
          vultron-card .vp-pill--przen { background: var(--vp-przen); }
          vultron-card .vp-pill--nieob { background: var(--vp-nieob); }

          /* Znacznik frekwencji i podpowiedź */
          vultron-card .vp-marker { padding: 0 2px; border-radius: 3px; font-size: 0.9em; font-weight: bold; }
          vultron-card .marker-wrapper { position: relative; display: inline-block; cursor: help; }
          vultron-card .vultron-tooltip {
            visibility: hidden; opacity: 0; background: rgba(var(--rgb-card-background-color, 255, 255, 255), 0.7);
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); text-align: center; border-radius: 6px;
            padding: 5px 10px; position: absolute; z-index: 100; bottom: 125%; right: 0; transform: translateY(10px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.2); border: 1px solid var(--divider-color);
            transition: all 0.2s ease-in-out; pointer-events: none; font-size: 0.8em; white-space: nowrap; font-weight: bold;
          }
          vultron-card .marker-wrapper:hover .vultron-tooltip { visibility: visible; opacity: 1; transform: translateY(0); }
        </style>
        <ha-card>
          <div class="vp-wrap">
            <div class="vp-head">
              <ha-icon-button id="prev-week" class="vp-nav">
                <ha-icon icon="mdi:chevron-left"></ha-icon>
              </ha-icon-button>

              <div class="vp-title">
                <div id="student-name" class="vp-student"></div>
                <div id="week-label" class="vp-week"></div>
              </div>

              <ha-icon-button id="next-week" class="vp-nav">
                <ha-icon icon="mdi:chevron-right"></ha-icon>
              </ha-icon-button>
            </div>

            <div id="table-wrapper" class="vp-scroll">
              <div class="vp-box">

                <!-- ŻÓŁTA KRESKA CZASU -->
                <div id="time-line" class="vp-line">
                  <div id="time-label" class="vp-line-label">--:--</div>
                </div>

                <table class="vp-table">
                  <thead>
                    <tr>
                      <th class="vp-th vp-th-time">GODZINA</th>
                      <th class="vp-th day-header">PON</th>
                      <th class="vp-th day-header">WT</th>
                      <th class="vp-th day-header">ŚR</th>
                      <th class="vp-th day-header">CZW</th>
                      <th class="vp-th day-header">PT</th>
                    </tr>
                  </thead>
                  <tbody id="plan-body"></tbody>
                </table>
              </div>
            </div>
          </div>
        </ha-card>
      `;
      this.content = this.querySelector('#plan-body');
      this.weekLabel = this.querySelector('#week-label');
      this.studentLabel = this.querySelector('#student-name');
      this.dayHeaders = this.querySelectorAll('.day-header');
      this.timeLine = this.querySelector('#time-line');
      this.timeLabel = this.querySelector('#time-label');

      // Zdarzenia podpinane raz
      this.querySelector('#prev-week').addEventListener('click', () => {
        if (this._weekOffset > -1) {
          this._weekOffset--;
          this._forceUpdate();
        }
      });

      this.querySelector('#next-week').addEventListener('click', () => {
        if (this._weekOffset < 1) {
          this._weekOffset++;
          this._forceUpdate();
        }
      });

      this._lineUpdater = setInterval(() => this.positionLine(), 10000);
    }

    if (!this.config || !this.config.entity) return;

    let suffix = this._weekOffset === 0 ? 'curr' : (this._weekOffset === -1 ? 'prev' : 'next');
    let baseEntity = this.config.entity.replace(/_(prev|curr|next)$/, '');
    let entityId = `${baseEntity}_${suffix}`;

    const planState = this._hass.states[entityId];
    const freqState = this.config.freq_entity ? this._hass.states[this.config.freq_entity] : null;

    // 2. STATE CACHING
    if (
      this._cachedPlanState === planState &&
      this._cachedFreqState === freqState &&
      this._cachedWeekOffset === this._weekOffset
    ) {
      // Kreska czasu ma przetrwać odświeżenia HA bez zmiany danych
      this.positionLine();
      return;
    }

    this._cachedPlanState = planState;
    this._cachedFreqState = freqState;
    this._cachedWeekOffset = this._weekOffset;

    // 3. Renderowanie
    this.updatePlan(planState, freqState, suffix);
  }

  _forceUpdate() {
    this._cachedWeekOffset = null;
    this.hass = this._hass;
  }

  connectedCallback() {
    // Atrybuty wolno ustawiać dopiero po podpięciu do DOM (nie w konstruktorze).
    this.setAttribute('data-version', VULTRON_CARD_VERSION);
  }

  disconnectedCallback() {
    if (this._lineUpdater) {
      clearInterval(this._lineUpdater);
      this._lineUpdater = null;
    }
  }

  getFormattedDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Rysuje kreskę aktualnej godziny
  positionLine() {
    if (!this.isConnected) return;
    if (this._weekOffset !== 0 || !this.content || !this.timeLine) {
      if(this.timeLine) this.timeLine.style.display = 'none';
      return;
    }

    const rows = Array.from(this.content.querySelectorAll('tr'));
    if (rows.length === 0 || rows[0].innerText.includes('Brak')) {
      this.timeLine.style.display = 'none';
      return;
    }

    const now = new Date();
    const h = now.getHours(), m = String(now.getMinutes()).padStart(2, '0');
    if(this.timeLabel) this.timeLabel.innerText = `${h}:${m}`;
    const cur = h * 60 + now.getMinutes();

    let pos = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const timeCell = row.querySelector('td');
      if (!timeCell) continue;

      // Jeśli komórki jeszcze nie wyrenderowały swoich wymiarów, przerwij - złapie na kolejnym ticku
      if (timeCell.offsetHeight === 0) return;

      const slot = timeCell.innerText;
      const p = slot.split(/[-–—]/); if(p.length < 2) continue;

      const s = parseInt(p[0].split(':')[0], 10)*60 + parseInt(p[0].split(':')[1], 10);
      const e = parseInt(p[1].split(':')[0], 10)*60 + parseInt(p[1].split(':')[1], 10);

      if (cur >= s && cur <= e) {
        pos = timeCell.offsetTop + (timeCell.offsetHeight * ((cur-s)/(e-s)));
        break;
      }
      if (i < rows.length - 1) {
        const nextRow = rows[i+1], nextSlotCell = nextRow.querySelector('td');
        if (!nextSlotCell) continue;

        const nextSlot = nextSlotCell.innerText;
        const nextS = parseInt(nextSlot.split(/[-–—]/)[0].split(':')[0], 10)*60 + parseInt(nextSlot.split(/[-–—]/)[0].split(':')[1], 10);

        if (cur > e && cur < nextS) {
          pos = (timeCell.offsetTop + timeCell.offsetHeight) + ((nextSlotCell.offsetTop - (timeCell.offsetTop + timeCell.offsetHeight)) * ((cur-e)/(nextS-e)));
          break;
        }
      }
    }

    if (pos !== -1) {
      this.timeLine.style.top = pos + "px";
      this.timeLine.style.display = 'block';
    } else {
      this.timeLine.style.display = 'none';
    }
  }

  updatePlan(planState, freqState, suffix) {
    if (!planState || (!planState.attributes.lekcje && !planState.attributes.dni_wolne)) {
      this.content.innerHTML = `<tr><td colspan="6" class="vp-empty">Brak danych planu (${suffix})</td></tr>`;
      return;
    }

    const todayISO = this.getFormattedDate(new Date()), now = new Date();
    const dayOfWeek = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek + 1 + (this._weekOffset * 7));
    const weekDates = [];

    for(let i=0; i<5; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const dISO = this.getFormattedDate(d); weekDates.push(dISO);
      if (this.dayHeaders[i]) {
        const isToday = dISO === todayISO;
        this.dayHeaders[i].innerHTML = `
          ${["PON","WT","ŚR","CZW","PT"][i]}<br>
          <span class="vp-date">
            ${dISO}
          </span>
        `;
        this.dayHeaders[i].classList.toggle('vp-today', isToday);
      }
    }

    this.studentLabel.innerText = (planState.attributes.friendly_name || '').replace(/Plan (prev|curr|next): /, '').replace('Plan: ', '');
    this.weekLabel.innerText = this._weekOffset === 0 ? "OBECNY TYDZIEŃ" : (this._weekOffset === -1 ? "POPRZEDNI TYDZIEŃ" : ("NASTĘPNY TYDZIEŃ" + (this._autoShiftedToNext ? " [SYMULATOR]" : "")));

    const lekcje = planState.attributes.lekcje || [];
    const dni_wolne = planState.attributes.dni_wolne || [];
    let slots = [...new Set(lekcje.map(l => l.g))].sort();

    const hasFreeDaysInWeek = weekDates.some(d => dni_wolne.some(fd => fd.d === d));
    if (slots.length === 0 && hasFreeDaysInWeek) {
      slots = ["08:00-08:45"];
    }

    let html = "";

    slots.forEach((slot, slotIndex) => {
      const [sT, eT] = slot.split(/[-–—]/);
      const sM = parseInt(sT.split(':')[0])*60 + parseInt(sT.split(':')[1]);
      const eM = parseInt(eT.split(':')[0])*60 + parseInt(eT.split(':')[1]);
      const nowM = now.getHours()*60 + now.getMinutes();
      const isNow = this._weekOffset === 0 && nowM >= sM && nowM < eM;

      html += `<tr><td class="vp-time${isNow ? ' vp-now' : ''}">${this._esc(slot)}</td>`;

      weekDates.forEach(date => {
        const freeDay = dni_wolne.find(fd => fd.d === date);
        if (freeDay) {
          if (slotIndex === 0) {
            const isToday = date === todayISO;
            const freeCls = 'vp-free' + (isToday ? ' vp-today' : '') + ((isToday && this._weekOffset === 0) ? ' vp-cur' : '');
            html += `
              <td rowspan="${slots.length}" class="${freeCls}">
                <div class="vp-free-box">
                  ${this._esc(freeDay.n)}
                </div>
              </td>`;
          }
        } else {
          const isToday = date === todayISO, isCur = isToday && isNow, lessons = lekcje.filter(lek => lek.d === date && lek.g === slot);
          let cellContent = "";
          lessons.forEach((l, idx) => {
            let statusTag = "", lessonCls = "", blockStyle = "";
            const pill = (mod, label) => `<div class="vp-pill vp-pill--${mod}">${label}</div>`;

            if (l.st === 'ODWOL') { lessonCls = " vp-lesson--odwol"; statusTag = pill('odwol', 'Odwołane'); }
            else if (l.st === 'ZWOL') { lessonCls = " vp-lesson--zwol"; statusTag = pill('zwol', 'Zwolnienie'); }
            else if (l.st === 'ZAST') { lessonCls = " vp-lesson--zast"; statusTag = pill('zast', 'Zastępstwo'); }
            else if (l.st === 'PRZEN') { lessonCls = " vp-lesson--przen"; statusTag = pill('przen', 'Przeniesione'); }
            else if (l.st === 'NIEOB') { lessonCls = " vp-lesson--nieob"; statusTag = pill('nieob', 'Nieobecni'); }
            else if (l.st === 'WLASNE') {
              // Kolor liczony dynamicznie z identyfikatora encji - jedyny styl inline.
              const _cc = this._customLessonColor();
              blockStyle = ` style="background: ${_cc}1A;"`;
              statusTag = `<div class="vp-pill" style="background: ${_cc};">Z kalendarza</div>`;
            }

            let marker = "";
            if (freqState && freqState.attributes.wpisy) {
              const planStart = l.g.split('-')[0].trim().replace(/^0/, "");
              const record = freqState.attributes.wpisy.find(f => f.d === date && f.t.trim().replace(/^0/, "") === planStart);
              if (record) {
                let color = "", text = "", desc = "";
                if (record.k === 1) { color = "#4caf50"; text = "[o]"; desc = "Obecność"; }
                else if (record.k === 2) { color = "#f44336"; text = "[n]"; desc = "Nieobecność"; }
                else if (record.k === 3) { color = "#2196f3"; text = "[nu]"; desc = "Usprawiedliwiona"; }
                else if (record.k === 4) { color = "#ff9800"; text = "[s]"; desc = "Spóźnienie"; }
                else if (record.k === 5) { color = "#00bcd4"; text = "[su]"; desc = "Spóźnienie uspraw."; }
                else if (record.k === 6) { color = "#9c27b0"; text = "[sz]"; desc = "Przyczyny szkolne"; }
                else if (record.k === 7) { color = "#607d8b"; text = "[zw]"; desc = "Zwolnienie"; }
                if (text) {
                  marker = `
                    <div class="marker-wrapper">
                      <b class="vp-marker" style="color: ${color}; background: ${color}1A;">${text}</b>
                      <div class="vultron-tooltip" style="color: ${color};">${desc}</div>
                    </div>`;
                }
              }
            }
            cellContent += `
              <div class="vp-lesson${lessonCls}"${blockStyle}>
                <div class="vp-corner">${marker}${statusTag}</div>
                <div class="vp-lesson-name">${this._esc(l.p)}</div>
                <div class="vp-lesson-meta">${this._esc(l.s)} ${l.n ? ' • ' + this._esc(l.n) : ''}</div>
              </div>`;
          });
          const cellCls = 'vp-cell' + (isToday ? ' vp-today' : '') + (isCur ? ' vp-now' : '');
          html += `
            <td class="${cellCls}">
              ${isCur ? '<div class="vp-now-tag">TERAZ</div>' : ''}
              ${cellContent}
            </td>`;
        }
      });
      html += `</tr>`;
    });

    this.content.innerHTML = html || `<tr><td colspan="6" class="vp-empty">Brak zajęć</td></tr>`;

    // Ponowne pozycjonowanie po ułożeniu kafelków przez HA
    if (this.isConnected) {
      this.positionLine();
      setTimeout(() => this.positionLine(), 100);
      setTimeout(() => this.positionLine(), 400);
    }
  }

  setConfig(config) {
    if (!config.entity) throw new Error("Entity missing");
    this.config = config;

    // Podgląd następnego tygodnia (np. w piątek wieczorem) - tylko w przeglądarce.
    const prog = config.next_week_from;
    const DNI_PROG = { pon: 0, wt: 1, sr: 2, czw: 3, pt: 4, sob: 5, nie: 6 };
    if (prog && DNI_PROG[prog.day] !== undefined) {
      const teraz = new Date();
      const dzienOdPoniedzialku = (teraz.getDay() + 6) % 7; // JS: 0=Nd -> 0=Pon
      const godzinyOdPoniedzialku = dzienOdPoniedzialku * 24 + teraz.getHours() + teraz.getMinutes() / 60;
      const granica = DNI_PROG[prog.day] * 24 + (prog.hour || 0);
      if (godzinyOdPoniedzialku >= granica) {
        this._weekOffset = 1;
        this._autoShiftedToNext = true;
      }
    }
  }

  getCardSize() { return 6; }
}

customElements.define("vultron-card", VultronPlanCard);

console.info(
  `%c VULTRON-CARD %c ${VULTRON_CARD_VERSION} `,
  'color: white; background: #03a9f4; font-weight: bold;',
  'color: #03a9f4; background: white; font-weight: bold;'
);