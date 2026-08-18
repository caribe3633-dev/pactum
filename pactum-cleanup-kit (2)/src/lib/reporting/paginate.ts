/**
 * Client-side pagination for printed reports.
 * Destination: src/lib/reporting/paginate.ts
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * A report needs BOTH of these, and until now it could only have one:
 *
 *   · nothing clipped — a section longer than a sheet must continue
 *   · an accurate "Page 3 of 7"
 *
 * Fixed sheets gave exact page numbers but CLIPPED anything too tall.
 * A flowing document never clipped but nobody knew the sheet count:
 * `counter(pages)` was tried and MEASURED in the target engine —
 * Chrome 131 returns 0, which is why the footer printed "Page 0 of 0".
 *
 * The only way to have both is to work out the breaks ourselves, and
 * that requires measuring rendered heights — which can only happen in a
 * live browser. So this ships as a script inside the generated document
 * rather than as build-time string assembly.
 *
 * HOW IT DECIDES
 *
 *   Nothing is assumed about the sheet. A 100mm probe converts
 *   millimetres to CSS pixels at the current zoom, and the usable height
 *   is read from the real gap between the rendered header and the
 *   rendered footer. Hard-coding "257mm of content" would be wrong the
 *   moment a header wrapped onto a second line.
 *
 *   Blocks are packed onto a page until one does not fit; that block
 *   starts the next page. A block that cannot fit on an empty page is
 *   SPLIT — table rows and contents-list items move across pages with
 *   their heading and column header repeated.
 *
 *   A block that is genuinely unsplittable is given its own page and
 *   that page is allowed to grow. It will spill onto a second sheet,
 *   which is ugly — but it is visible, and the alternative is clipping
 *   it away where nobody can tell it is gone.
 *
 * WHAT IT REFUSES TO DO
 *
 *   It never prints a page number it has not counted. The numbers are
 *   written after the pages exist, from `pages.length`.
 * ══════════════════════════════════════════════════════════════════════
 */

export const PAGINATE_JS = String.raw`
(function () {
  'use strict';

  function paginate() {
    var src = document.getElementById('r-src');
    var mount = document.getElementById('r-pages');
    if (!src || !mount) { window.__paginated = true; return; }

    var land = document.body.classList.contains('r-land');

    // Millimetres to CSS pixels, measured rather than assumed.
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:0;width:100mm';
    document.body.appendChild(probe);
    var unit = probe.offsetWidth / 100;
    probe.parentNode.removeChild(probe);
    if (!(unit > 0)) { window.__paginated = true; return; }

    var headTpl = document.getElementById('r-tpl-head');
    var footTpl = document.getElementById('r-tpl-foot');
    var wmTpl   = document.getElementById('r-tpl-wm');
    var headHtml = headTpl ? headTpl.innerHTML : '';
    var footHtml = footTpl ? footTpl.innerHTML : '';
    var wmHtml   = wmTpl ? wmTpl.innerHTML : '';

    var pages = [];
    var page = null, hold = null, room = 0;

    function addPage() {
      var sec = document.createElement('section');
      sec.className = 'r-page';
      sec.innerHTML = wmHtml +
        '<div class="r-body">' + headHtml +
        '<div class="r-page-content"></div></div>' + footHtml;
      mount.appendChild(sec);
      pages.push(sec);
      page = sec;
      hold = sec.querySelector('.r-page-content');

      // THE USABLE HEIGHT, MEASURED CORRECTLY.
      //
      // The first attempt used "hold.offsetTop" and "foot.offsetTop".
      // Those are relative to the nearest POSITIONED ancestor, which is
      // the page for one and the body for the other, so the subtraction
      // mixed two coordinate systems and returned a room larger than the
      // sheet. Measured result: sheets 1123px tall holding 1296px of
      // content — every page overflowed onto an extra sheet, and only
      // the first of those carried the footer.
      //
      // getBoundingClientRect() puts every value in the same viewport
      // space, so the arithmetic is valid.
      var foot = sec.querySelector('.r-foot');
      var pr = sec.getBoundingClientRect();
      var hr = hold.getBoundingClientRect();
      var fr = foot ? foot.getBoundingClientRect() : null;
      var bottom = fr ? fr.top : (pr.bottom - (land ? 20 : 22) * unit);
      // 8mm of clearance, not 2. Measured: at 2mm the last block on a
      // page printed ON TOP of the footer rule - the footer is pinned so
      // it does not push content, and a block that ends flush against it
      // overlaps the border and the copyright line.
      room = bottom - hr.top - 8 * unit;
      if (!(room > 0)) room = (land ? 130 : 210) * unit;
      return hold;
    }

    function overflows() { return hold.scrollHeight > room + 1; }

    /**
     * Moves repeatable children of a too-tall block across pages.
     * Returns false when the block has no such children.
     */
    function split(node) {
      var listSel = null, itemSel = null;
      if (node.querySelector('.r-toc')) { listSel = '.r-toc'; itemSel = ':scope > li'; }
      else if (node.querySelector('.r-table tbody')) { listSel = '.r-table tbody'; itemSel = ':scope > tr'; }
      else return false;

      var srcList = node.querySelector(listSel);
      var items = [];
      var kids = srcList.children;
      for (var i = 0; i < kids.length; i++) items.push(kids[i]);
      if (items.length < 2) return false;

      // A shell is the block with its list emptied: heading, column
      // header and note are reproduced on every continuation page.
      function shell() {
        var c = node.cloneNode(true);
        var l = c.querySelector(listSel);
        while (l.firstChild) l.removeChild(l.firstChild);
        // A running total belongs on the last part only.
        var tf = c.querySelector('.r-table tfoot');
        if (tf) tf.parentNode.removeChild(tf);
        return c;
      }

      var part = shell();
      hold.appendChild(part);
      var into = part.querySelector(listSel);

      for (var k = 0; k < items.length; k++) {
        into.appendChild(items[k]);
        if (overflows()) {
          into.removeChild(items[k]);
          // An empty part means one single row is taller than a page;
          // leave it in place and let that page grow rather than lose it.
          if (into.children.length === 0) { into.appendChild(items[k]); continue; }
          addPage();
          part = shell();
          hold.appendChild(part);
          into = part.querySelector(listSel);
          into.appendChild(items[k]);
        }
      }
      // The totals row rides with the final part.
      var foot = node.querySelector('.r-table tfoot');
      if (foot) {
        part.querySelector('.r-table').appendChild(foot);
        if (overflows()) {
          addPage();
          var last = shell();
          last.querySelector('.r-table').appendChild(foot);
          hold.appendChild(last);
        }
      }
      return true;
    }

    var blocks = [];
    var n = src.children;
    for (var b = 0; b < n.length; b++) blocks.push(n[b]);

    addPage();

    for (var j = 0; j < blocks.length; j++) {
      var block = blocks[j];
      // A marker is an instruction, not content.
      if (block.classList.contains('r-break-marker')) {
        if (hold.children.length) addPage();
        continue;
      }

      hold.appendChild(block);
      if (!overflows()) continue;

      hold.removeChild(block);
      if (hold.children.length) addPage();
      hold.appendChild(block);
      if (!overflows()) continue;

      // Still too tall on a page of its own.
      hold.removeChild(block);
      if (!split(block)) {
        // Unsplittable. Give it the page and let the page grow: a break
        // in an awkward place is recoverable, a deleted section is not.
        hold.appendChild(block);
        page.classList.add('r-page-tall');
      }
    }

    src.parentNode.removeChild(src);

    // ── Numbering, written only after the pages exist ──
    var cover = document.querySelector('.r-page-cover');
    var total = pages.length + (cover ? 1 : 0);
    function stamp(el, i) {
      var t = el.querySelector('.r-pageno');
      if (t) t.textContent = 'Page ' + i + ' of ' + total;
    }
    if (cover) stamp(cover, 1);
    for (var q = 0; q < pages.length; q++) stamp(pages[q], q + 1 + (cover ? 1 : 0));

    window.__paginated = true;
    document.documentElement.setAttribute('data-pages', String(total));
  }

  function start() {
    // Fonts change line heights, so measuring before they land would
    // pack the pages against the wrong numbers.
    var f = document.fonts;
    if (f && f.ready && f.ready.then) f.ready.then(paginate).catch(paginate);
    else paginate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }
})();
`;
