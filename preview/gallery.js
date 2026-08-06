/* =============================================================
   Dreaming of Ukraine — exhibition gallery
   Self-contained, no dependencies, no globals beyond nothing.
   Consumes the public JSON feed only.
   ============================================================= */
(function () {
  "use strict";

  var DATA_URL =
    "https://bsmaha.github.io/dreaming-of-ukraine-gallery/gallery-data.json";
  var ALL = "__all__";
  var NEIGHBOURS = 2; // panels rendered either side of the active work
  var svgNS = "http://www.w3.org/2000/svg";

  /* ---------- tiny helpers ------------------------------------------ */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function icon(paths, extra) {
    var s = document.createElementNS(svgNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("focusable", "false");
    paths.forEach(function (d) {
      var p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", d);
      s.appendChild(p);
    });
    if (extra) {
      var c = document.createElementNS(svgNS, "circle");
      c.setAttribute("cx", extra[0]);
      c.setAttribute("cy", extra[1]);
      c.setAttribute("r", extra[2]);
      s.insertBefore(c, s.firstChild);
    }
    return s;
  }

  var ICON = {
    prev: ["M15 5 8 12l7 7"],
    next: ["M9 5l7 7-7 7"],
    zoom: ["M20.5 20.5 16.2 16.2", "M7 10.5h7", "M10.5 7v7"],
    plus: ["M12 6v12", "M6 12h12"],
    minus: ["M6 12h12"],
    close: ["M6 6l12 12", "M18 6 6 18"],
    cart: ["M4 5h2l2.2 9.4A2 2 0 0 0 10.1 16H18", "M6.6 8H20l-1.7 6H8"]
  };

  function isHttps(url) {
    if (typeof url !== "string" || !url) return false;
    try {
      return new URL(url, window.location.href).protocol === "https:";
    } catch (e) {
      return false;
    }
  }

  function initials(name) {
    return String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (w) {
        return w.charAt(0).toUpperCase();
      })
      .join("");
  }

  function matchesMedium(work, selected) {
    if (!selected || selected === ALL) return true;
    var target = String(selected).toLowerCase();
    var list = Array.isArray(work.mediumFilters) ? work.mediumFilters : [];
    return list.some(function (value) {
      return String(value).toLowerCase() === target;
    });
  }

  function shuffled(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ),
      function (n) {
        return n.offsetWidth || n.offsetHeight || n === document.activeElement;
      }
    );
  }

  var lockCount = 0;
  function lockScroll(on) {
    lockCount = Math.max(0, lockCount + (on ? 1 : -1));
    document.documentElement.classList.toggle("dou-locked", lockCount > 0);
  }

  /* ---------- normalisation ---------------------------------------- */

  function normalise(feed) {
    var authors = {};
    (feed.authors || []).forEach(function (a) {
      if (a && a.name) authors[a.name] = a;
    });

    var works = (feed.artworks || [])
      .filter(function (a) {
        return a && a.title && a.image && a.image.url;
      })
      .map(function (a) {
        var d = a.dimensions || {};
        var w = Number(d.width) || 0;
        var h = Number(d.height) || 0;
        var ar = w > 0 && h > 0 ? w / h : a.orientation === "portrait" ? 0.78 : a.orientation === "landscape" ? 1.35 : 1;
        var artist = a.artist || authors[a.artistName] || null;
        return {
          id: a.id || a.stripeProductId || a.title,
          title: String(a.title),
          artistName: a.artistName ? String(a.artistName) : "",
          artist: artist,
          medium: a.medium ? String(a.medium) : "",
          mediumFilters: Array.isArray(a.mediumFilters)
            ? a.mediumFilters.filter(Boolean).map(String)
            : a.medium
            ? [String(a.medium)]
            : [],
          dimLabel: d.label ? String(d.label) : dimFallback(d),
          orientation: a.orientation || "unknown",
          aspect: ar,
          price: a.price && a.price.formatted ? String(a.price.formatted) : "",
          status: a.status || "unknown",
          description: a.description ? String(a.description) : "",
          image: {
            url: String(a.image.url),
            alt: a.image.alt ? String(a.image.alt) : String(a.title)
          },
          checkoutUrl: isHttps(a.checkoutUrl) ? a.checkoutUrl : "",
          framed: typeof a.framed === "boolean" ? a.framed : null
        };
      });

    return { works: works, authors: authors, exhibition: feed.exhibition || {} };
  }

  function dimFallback(d) {
    if (!d || !d.width || !d.height) return "";
    var unit = d.unit ? " " + d.unit : "";
    return d.width + " \u00d7 " + d.height + unit;
  }

  function authorPhoto(artist, size) {
    if (!artist) return "";
    var p = artist.photo || artist.image || artist.profileImage || null;
    var url = "";
    if (typeof p === "string") url = p;
    else if (p && typeof p.url === "string") url = p.url;
    else if (typeof artist.photoUrl === "string") url = artist.photoUrl;
    if (url && size && /drive\.google\.com\/thumbnail/.test(url)) {
      url = url.replace(/([?&]sz=w)\d+/, "$1" + size);
    }
    return url;
  }

  function authorBio(artist) {
    if (!artist) return "";
    var b = artist.bio || artist.biography || artist.description || "";
    return typeof b === "string" ? b : "";
  }

  function hasBio(artist) {
    return !!(artist && (authorBio(artist) || authorPhoto(artist)));
  }

  /* ---------- gallery --------------------------------------------- */

  function Gallery(root) {
    this.root = root;
    this.works = [];
    this.session = [];
    this.view = [];
    this.index = 0;
    this.filters = { artist: ALL, medium: ALL, framed: ALL };
    this.panels = [];
    this.dragDX = 0;
    this.build();
    this.load();
  }

  Gallery.prototype.build = function () {
    var g = this;
    var r = this.root;
    r.textContent = "";

    /* filters ------------------------------------------------------ */
    this.filterWrap = el("div", "dou-filters-wrap");
    var fc = el("div", "dou-container");
    this.filterBar = el("div", "dou-filters");
    fc.appendChild(this.filterBar);
    this.filterWrap.appendChild(fc);
    this.filterWrap.hidden = true;

    this.selArtist = this.field("Artist", "artist");
    this.selMedium = this.field("Medium", "medium");
    this.selFramed = this.field("Frame", "framed");

    var meta = el("div", "dou-filters-meta");
    this.countEl = el("p", "dou-count");
    this.clearBtn = el("button", "dou-clear", "Clear filters");
    this.clearBtn.type = "button";
    this.clearBtn.hidden = true;
    this.clearBtn.setAttribute("data-gallery-action", "filter");
    this.clearBtn.addEventListener("click", function () {
      g.setFilters({ artist: ALL, medium: ALL, framed: ALL }, true);
    });
    meta.appendChild(this.countEl);
    meta.appendChild(this.clearBtn);
    this.filterBar.appendChild(meta);

    /* stage -------------------------------------------------------- */
    this.band = el("div", "dou-band");
    this.stage = el("div", "dou-stage");
    this.stage.tabIndex = 0;
    this.stage.setAttribute("role", "group");
    this.stage.setAttribute("aria-roledescription", "artwork carousel");
    this.stage.setAttribute("aria-label", "Exhibition artworks. Use the left and right arrow keys to browse.");
    this.track = el("div", "dou-track");
    this.stage.appendChild(this.track);

    this.foot = el("div", "dou-stage-foot");
    this.prevBtn = this.navBtn("previous", "Previous artwork", ICON.prev);
    this.nextBtn = this.navBtn("next", "Next artwork", ICON.next);
    this.posEl = el("p", "dou-position");
    this.foot.appendChild(this.prevBtn);
    this.foot.appendChild(this.posEl);
    this.foot.appendChild(this.nextBtn);

    this.band.appendChild(this.stage);
    this.band.appendChild(this.foot);
    this.band.hidden = true;

    /* details ------------------------------------------------------ */
    this.detailsWrap = el("div", "dou-container");
    this.details = el("div", "dou-details");
    this.detailsWrap.appendChild(this.details);
    this.detailsWrap.hidden = true;

    /* status ------------------------------------------------------- */
    this.status = el("div", "dou-container");
    this.live = el("p", "dou-sr");
    this.live.setAttribute("aria-live", "polite");

    r.appendChild(this.filterWrap);
    r.appendChild(this.band);
    r.appendChild(this.detailsWrap);
    r.appendChild(this.status);
    r.appendChild(this.live);

    this.bindStage();
  };

  Gallery.prototype.field = function (label, key) {
    var g = this;
    var wrap = el("div", "dou-field");
    var id = "dou-filter-" + key;
    var lab = el("label", null, label);
    lab.htmlFor = id;
    var sel = el("select", "dou-select");
    sel.id = id;
    sel.setAttribute("data-gallery-action", "filter");
    sel.setAttribute("data-filter", key);
    sel.addEventListener("change", function () {
      var next = {};
      next[key] = sel.value;
      g.setFilters(next, true);
    });
    wrap.appendChild(lab);
    wrap.appendChild(sel);
    this.filterBar.appendChild(wrap);
    return sel;
  };

  Gallery.prototype.navBtn = function (action, label, path) {
    var g = this;
    var b = el("button", "dou-nav");
    b.type = "button";
    b.setAttribute("data-gallery-action", action);
    b.setAttribute("aria-label", label);
    b.appendChild(icon(path));
    b.addEventListener("click", function () {
      g.go(action === "next" ? 1 : -1);
    });
    return b;
  };

  /* ---------- data ------------------------------------------------ */

  Gallery.prototype.showBoot = function () {
    this.status.textContent = "";
    var box = el("div", "dou-boot");
    box.appendChild(el("div", "dou-boot-frame"));
    box.appendChild(el("p", "dou-boot-note", "Preparing the exhibition"));
    this.status.appendChild(box);
  };

  Gallery.prototype.showError = function () {
    var g = this;
    this.band.hidden = true;
    this.detailsWrap.hidden = true;
    this.filterWrap.hidden = true;
    this.status.textContent = "";
    var box = el("div", "dou-panelbox");
    box.appendChild(el("h2", null, "The gallery could not be loaded"));
    box.appendChild(
      el(
        "p",
        null,
        "We could not reach the exhibition catalogue just now. Please check your connection and try again."
      )
    );
    var btn = el("button", "dou-btn dou-btn-primary", "Retry");
    btn.type = "button";
    btn.addEventListener("click", function () {
      g.load();
    });
    box.appendChild(btn);
    this.status.appendChild(box);
  };

  Gallery.prototype.showEmpty = function () {
    var g = this;
    this.status.textContent = "";
    var box = el("div", "dou-panelbox");
    box.appendChild(el("h2", null, "No works match these filters"));
    box.appendChild(
      el("p", null, "Try a different combination, or return to the full exhibition.")
    );
    var btn = el("button", "dou-btn dou-btn-primary", "Clear filters");
    btn.type = "button";
    btn.setAttribute("data-gallery-action", "filter");
    btn.addEventListener("click", function () {
      g.setFilters({ artist: ALL, medium: ALL, framed: ALL }, true);
    });
    box.appendChild(btn);
    this.status.appendChild(box);
  };

  Gallery.prototype.load = function () {
    var g = this;
    this.showBoot();
    fetch(DATA_URL, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (feed) {
        var data = normalise(feed);
        if (!data.works.length) throw new Error("empty catalogue");
        g.works = data.works;
        g.authors = data.authors;
        g.session = shuffled(data.works);
        g.buildFilterOptions();
        g.readUrl();
        g.status.textContent = "";
        g.filterWrap.hidden = false;
        g.band.hidden = false;
        g.detailsWrap.hidden = false;
        g.apply(false);
        g.bindHistory();
      })
      .catch(function (err) {
        if (window.console && console.warn) console.warn("[dou-gallery]", err);
        g.showError();
      });
  };

  Gallery.prototype.buildFilterOptions = function () {
    var artists = [];
    var media = [];
    this.works.forEach(function (w) {
      if (w.artistName && artists.indexOf(w.artistName) < 0) artists.push(w.artistName);
      w.mediumFilters.forEach(function (m) {
        if (media.indexOf(m) < 0) media.push(m);
      });
    });
    artists.sort();
    media.sort();

    fill(this.selArtist, "All artists", artists);
    fill(this.selMedium, "All media", media);
    fill(this.selFramed, "All", ["Framed", "Unframed"], ["framed", "unframed"]);

    function fill(sel, allLabel, labels, values) {
      sel.textContent = "";
      sel.appendChild(opt(ALL, allLabel));
      labels.forEach(function (l, i) {
        sel.appendChild(opt(values ? values[i] : l, l));
      });
    }
    function opt(v, l) {
      var o = document.createElement("option");
      o.value = v;
      o.textContent = l;
      return o;
    }
  };

  /* ---------- filters + url --------------------------------------- */

  Gallery.prototype.setFilters = function (next, push) {
    var changed = false;
    for (var k in next) {
      if (this.filters[k] !== next[k]) {
        this.filters[k] = next[k];
        changed = true;
      }
    }
    if (!changed) return;
    this.syncSelects();
    this.apply(true);
    if (push) this.writeUrl(true);
  };

  Gallery.prototype.syncSelects = function () {
    this.selArtist.value = this.filters.artist;
    this.selMedium.value = this.filters.medium;
    this.selFramed.value = this.filters.framed;
    if (this.selArtist.value !== this.filters.artist) this.filters.artist = ALL, (this.selArtist.value = ALL);
    if (this.selMedium.value !== this.filters.medium) this.filters.medium = ALL, (this.selMedium.value = ALL);
  };

  Gallery.prototype.active = function () {
    return (
      this.filters.artist !== ALL ||
      this.filters.medium !== ALL ||
      this.filters.framed !== ALL
    );
  };

  Gallery.prototype.apply = function (resetIndex) {
    var f = this.filters;
    this.view = this.session.filter(function (w) {
      if (f.artist !== ALL && w.artistName !== f.artist) return false;
      if (f.medium !== ALL && !matchesMedium(w, f.medium)) return false;
      if (f.framed === "framed" && w.framed !== true) return false;
      if (f.framed === "unframed" && w.framed !== false) return false;
      return true;
    });
    if (resetIndex !== false) this.index = 0;
    if (this.index >= this.view.length) this.index = 0;

    this.clearBtn.hidden = !this.active();
    this.updateCount();

    if (!this.view.length) {
      this.band.hidden = true;
      this.detailsWrap.hidden = true;
      this.showEmpty();
      return;
    }
    this.status.textContent = "";
    this.band.hidden = false;
    this.detailsWrap.hidden = false;
    this.buildPanels();
    this.render();
  };

  Gallery.prototype.updateCount = function () {
    var n = this.view.length;
    var word = plural(n, "artwork", "artworks");
    var text;
    if (!this.active()) text = n + " " + word;
    else if (this.filters.artist !== ALL && this.filters.medium === ALL && this.filters.framed === ALL)
      text = n + " " + word + " by " + this.filters.artist;
    else text = n + " filtered " + plural(n, "work", "works");
    this.countEl.textContent = text;
  };

  Gallery.prototype.writeUrl = function (push) {
    if (!window.history || !history.replaceState) return;
    var p = new URLSearchParams(window.location.search);
    setP("artist", this.filters.artist);
    setP("medium", this.filters.medium);
    setP("framed", this.filters.framed);
    var cur = this.view[this.index];
    if (cur) p.set("artwork", cur.id);
    else p.delete("artwork");
    var url =
      window.location.pathname + (p.toString() ? "?" + p.toString() : "") ;
    try {
      history[push ? "pushState" : "replaceState"]({ dou: true }, "", url);
    } catch (e) {
      /* ignore */
    }
    function setP(k, v) {
      if (v === ALL) p.delete(k);
      else p.set(k, v);
    }
  };

  Gallery.prototype.readUrl = function () {
    var p = new URLSearchParams(window.location.search);
    var artist = p.get("artist");
    var medium = p.get("medium");
    var framed = p.get("framed");
    this.filters.artist = artist || ALL;
    this.filters.medium = medium || ALL;
    this.filters.framed = framed === "framed" || framed === "unframed" ? framed : ALL;
    this.syncSelects();
    this.pendingArtwork = p.get("artwork") || null;
  };

  Gallery.prototype.bindHistory = function () {
    var g = this;
    window.addEventListener("popstate", function () {
      g.readUrl();
      g.apply(true);
      g.jumpToPending();
    });
    this.jumpToPending();
  };

  Gallery.prototype.jumpToPending = function () {
    if (!this.pendingArtwork) return;
    var id = this.pendingArtwork;
    this.pendingArtwork = null;
    for (var i = 0; i < this.view.length; i++) {
      if (this.view[i].id === id) {
        this.index = i;
        this.render();
        return;
      }
    }
  };

  /* ---------- panels + 3d layout ---------------------------------- */

  Gallery.prototype.buildPanels = function () {
    var g = this;
    this.track.textContent = "";
    this.panels = this.view.map(function (w, i) {
      var panel = el("div", "dou-panel");
      panel.setAttribute("data-index", String(i));
      var frame = el("figure", "dou-frame");
      frame.style.setProperty("--dou-ar", String(w.aspect));
      var img = el("img", "dou-img");
      img.alt = w.image.alt;
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
      img.addEventListener("load", function () {
        img.setAttribute("data-loaded", "true");
      });
      img.addEventListener("error", function () {
        panel.setAttribute("data-failed", "true");
      });
      var fb = el("div", "dou-fallback");
      fb.appendChild(el("p", "dou-fallback-title", w.title));
      fb.appendChild(el("p", "dou-fallback-note", "Image unavailable"));
      frame.appendChild(img);
      frame.appendChild(fb);
      panel.appendChild(frame);
      panel.addEventListener("click", function () {
        if (g.dragged) return;
        if (i === g.index) g.openZoom();
        else g.goTo(i);
      });
      g.track.appendChild(panel);
      return { el: panel, img: img, work: w, loaded: false };
    });
  };

  Gallery.prototype.layout = function () {
    var g = this;
    var w = this.stage.clientWidth || 1;
    var spreadPct = parseFloat(
      getComputedStyle(this.root).getPropertyValue("--dou-panel-spread")
    ) || 34;
    var spread = (w * spreadPct) / 100;
    var nScale =
      parseFloat(getComputedStyle(this.root).getPropertyValue("--dou-panel-scale")) || 0.7;
    var nRot =
      parseFloat(getComputedStyle(this.root).getPropertyValue("--dou-panel-rotate")) || 0;
    var nOp =
      parseFloat(getComputedStyle(this.root).getPropertyValue("--dou-panel-opacity")) || 0.5;
    var total = this.panels.length;
    var maxOff = total <= 3 ? 1 : NEIGHBOURS;

    this.panels.forEach(function (p, i) {
      var d = i - g.index;
      if (total > 2) {
        if (d > total / 2) d -= total;
        if (d < -total / 2) d += total;
      }
      var abs = Math.abs(d);
      var visible = abs <= maxOff;
      var x = d * spread * (abs > 1 ? 0.82 : 1) + g.dragDX * (abs === 0 ? 1 : 0.6);
      var scale = abs === 0 ? 1 : abs === 1 ? nScale : nScale * 0.72;
      var op = abs === 0 ? 1 : abs === 1 ? nOp : nOp * 0.5;
      var rot = abs === 0 ? 0 : -Math.sign(d) * nRot;
      p.el.style.transform =
        "translate(calc(-50% + " + x.toFixed(1) + "px), -50%) " +
        "scale(" + scale.toFixed(3) + ") rotateY(" + rot.toFixed(2) + "deg)";
      p.el.style.opacity = visible ? String(op) : "0";
      p.el.style.zIndex = String(50 - abs * 10);
      p.el.setAttribute("data-visible", visible ? "true" : "false");
      p.el.setAttribute("data-active", abs === 0 ? "true" : "false");
      if (visible) p.el.removeAttribute("aria-hidden");
      else p.el.setAttribute("aria-hidden", "true");
      if (abs === 0) p.el.removeAttribute("inert");
      else p.el.setAttribute("inert", "");

      if (visible && !p.loaded) {
        p.loaded = true;
        p.img.src = p.work.image.url;
      }
    });
  };

  Gallery.prototype.render = function () {
    this.layout();
    this.renderDetails();
    this.posEl.textContent = this.index + 1 + " of " + this.view.length;
    var cur = this.view[this.index];
    if (cur) {
      this.live.textContent =
        cur.title +
        (cur.artistName ? " by " + cur.artistName : "") +
        ", " +
        (this.index + 1) +
        " of " +
        this.view.length;
    }
    var loop = this.view.length > 1;
    this.prevBtn.disabled = !loop;
    this.nextBtn.disabled = !loop;
  };

  Gallery.prototype.go = function (dir) {
    if (this.view.length < 2) return;
    this.goTo((this.index + dir + this.view.length) % this.view.length);
  };

  Gallery.prototype.goTo = function (i) {
    if (i === this.index || i < 0 || i >= this.view.length) return;
    this.index = i;
    this.render();
    this.writeUrl(false);
  };

  Gallery.prototype.bindStage = function () {
    var g = this;

    this.stage.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        g.go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        g.go(-1);
      }
    });

    /* pointer drag / swipe */
    var startX = 0;
    var startY = 0;
    var dragging = false;
    var pid = null;

    this.stage.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      pid = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
      g.dragged = false;
    });

    this.stage.addEventListener("pointermove", function (e) {
      if (!dragging || e.pointerId !== pid) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!g.dragged && Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.6) return;
      g.dragged = true;
      g.dragDX = dx * 0.55;
      g.panels.forEach(function (p) {
        p.el.style.transitionDuration = "0ms";
      });
      g.layout();
    });

    function end(e) {
      if (!dragging || (e && e.pointerId !== pid)) return;
      dragging = false;
      pid = null;
      g.panels.forEach(function (p) {
        p.el.style.transitionDuration = "";
      });
      var dx = g.dragDX;
      g.dragDX = 0;
      if (Math.abs(dx) > g.stage.clientWidth * 0.07) g.go(dx < 0 ? 1 : -1);
      else g.layout();
      setTimeout(function () {
        g.dragged = false;
      }, 0);
    }

    this.stage.addEventListener("pointerup", end);
    this.stage.addEventListener("pointercancel", end);
    this.stage.addEventListener("pointerleave", end);

    /* horizontal wheel / trackpad */
    var wheelLock = false;
    this.stage.addEventListener(
      "wheel",
      function (e) {
        if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.3) return;
        e.preventDefault();
        if (wheelLock) return;
        wheelLock = true;
        g.go(e.deltaX > 0 ? 1 : -1);
        setTimeout(function () {
          wheelLock = false;
        }, 420);
      },
      { passive: false }
    );

    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (g.panels.length) g.layout();
      }, 120);
    });
  };

  /* ---------- details panel --------------------------------------- */

  Gallery.prototype.renderDetails = function () {
    var g = this;
    var w = this.view[this.index];
    if (!w) return;
    this.details.textContent = "";

    var left = el("div", "dou-detail-main");
    var h = el("h2", "dou-art-title", w.title);
    left.appendChild(h);

    var metaBits = [w.medium, w.dimLabel].filter(Boolean);
    var meta = el("p", "dou-meta", metaBits.join(" \u00b7 "));
    if (w.framed !== null) {
      meta.appendChild(el("span", "dou-tag", w.framed ? "Framed" : "Unframed"));
    }
    left.appendChild(meta);

    if (w.artistName) {
      if (hasBio(w.artist)) {
        var btn = el("button", "dou-artist");
        btn.type = "button";
        btn.setAttribute("data-gallery-action", "author-bio");
        btn.setAttribute("data-artwork-id", w.id);
        btn.setAttribute("data-artist-name", w.artistName);
        btn.appendChild(avatar(w));
        var col = el("span", "dou-artist-text");
        col.style.display = "flex";
        col.style.flexDirection = "column";
        col.appendChild(el("span", "dou-artist-name", w.artistName));
        col.appendChild(el("span", "dou-artist-hint", "About the artist"));
        btn.appendChild(col);
        btn.addEventListener("click", function () {
          g.openBio(w, btn);
        });
        left.appendChild(btn);
      } else {
        var span = el("p", "dou-artist");
        span.appendChild(el("span", "dou-artist-name", w.artistName));
        left.appendChild(span);
      }
    }

    if (w.description) {
      var desc = el("p", "dou-description", w.description);
      desc.setAttribute("data-clamped", "true");
      left.appendChild(desc);
      var more = el("button", "dou-more", "Read more");
      more.type = "button";
      more.setAttribute("aria-expanded", "false");
      more.addEventListener("click", function () {
        var open = desc.getAttribute("data-clamped") === "true";
        desc.setAttribute("data-clamped", open ? "false" : "true");
        more.setAttribute("aria-expanded", open ? "true" : "false");
        more.textContent = open ? "Show less" : "Read more";
      });
      left.appendChild(more);
      requestAnimationFrame(function () {
        more.hidden = desc.scrollHeight <= desc.clientHeight + 2;
      });
    }

    /* right column */
    var right = el("div", "dou-buy");
    var price = el("p", "dou-price", w.price);
    price.hidden = !w.price || (w.status === "not_for_sale" && !w.price);
    right.appendChild(price);

    var actions = el("div", "dou-actions");
    if (w.status === "available" && w.checkoutUrl) {
      var a = el("a", "dou-btn dou-btn-primary");
      a.href = w.checkoutUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.appendChild(icon(ICON.cart));
      a.appendChild(document.createTextNode("Purchase"));
      a.setAttribute("data-gallery-action", "purchase");
      a.setAttribute("data-artwork-id", w.id);
      a.setAttribute("data-artwork-title", w.title);
      a.setAttribute("data-artist-name", w.artistName);
      actions.appendChild(a);
    } else if (w.status === "sold") {
      actions.appendChild(el("p", "dou-state", "Sold"));
    } else if (w.status === "not_for_sale") {
      actions.appendChild(el("p", "dou-state", "Not for sale"));
    } else if (w.status === "available") {
      if (window.console && console.warn)
        console.warn("[dou-gallery] available artwork without checkout URL:", w.id);
      actions.appendChild(el("p", "dou-state", "Enquire for availability"));
    }

    var zoom = el("button", "dou-btn dou-btn-quiet");
    zoom.type = "button";
    zoom.appendChild(icon(ICON.zoom));
    zoom.appendChild(document.createTextNode("View larger"));
    zoom.setAttribute("data-gallery-action", "zoom");
    zoom.setAttribute("data-artwork-id", w.id);
    zoom.setAttribute("data-artwork-title", w.title);
    zoom.addEventListener("click", function () {
      g.openZoom(zoom);
    });
    actions.appendChild(zoom);
    right.appendChild(actions);

    this.details.appendChild(left);
    this.details.appendChild(right);

    function avatar(work) {
      var url = authorPhoto(work.artist, 200);
      if (!url) return el("span", "dou-initials", initials(work.artistName));
      var img = el("img", "dou-avatar");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", function () {
        img.replaceWith(el("span", "dou-initials", initials(work.artistName)));
      });
      return img;
    }
  };

  /* ---------- overlay base ---------------------------------------- */

  function Overlay(trigger, label) {
    this.trigger = trigger || document.activeElement;
    this.node = el("div", "dou-overlay");
    this.node.setAttribute("role", "dialog");
    this.node.setAttribute("aria-modal", "true");
    this.node.setAttribute("aria-label", label);
    var self = this;
    this.onKey = function (e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        self.close();
      } else if (e.key === "Tab") {
        var f = focusables(self.node);
        if (!f.length) return;
        var first = f[0];
        var last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
  }

  Overlay.prototype.closeBtn = function () {
    var self = this;
    var b = el("button", "dou-overlay-close");
    b.type = "button";
    b.setAttribute("aria-label", "Close");
    b.appendChild(icon(ICON.close));
    b.addEventListener("click", function () {
      self.close();
    });
    return b;
  };

  Overlay.prototype.open = function () {
    document.body.appendChild(this.node);
    document.addEventListener("keydown", this.onKey, true);
    lockScroll(true);
    var f = focusables(this.node);
    (f[0] || this.node).focus();
  };

  Overlay.prototype.close = function () {
    document.removeEventListener("keydown", this.onKey, true);
    lockScroll(false);
    if (this.node.parentNode) this.node.parentNode.removeChild(this.node);
    if (this.trigger && this.trigger.focus) this.trigger.focus();
  };

  /* ---------- lightbox -------------------------------------------- */

  Gallery.prototype.openZoom = function (trigger) {
    var w = this.view[this.index];
    if (!w) return;
    openImageOverlay({
      url: w.image.url,
      alt: w.image.alt,
      title: w.title,
      subtitle: w.artistName,
      trigger: trigger
    });
  };

  /* Shared image viewer — used by the carousel and by the event flyer. */
  function openImageOverlay(opts) {
    var w = {
      image: { url: opts.url, alt: opts.alt || opts.title || "" },
      title: opts.title || "",
      artistName: opts.subtitle || ""
    };
    var o = new Overlay(opts.trigger, "Image viewer: " + w.title);

    var vp = el("div", "dou-zoom-viewport");
    vp.setAttribute("data-zoomed", "false");
    var img = el("img", "dou-zoom-img");
    img.alt = w.image.alt;
    img.decoding = "async";
    img.draggable = false;
    img.src = w.image.url;
    vp.appendChild(img);

    var cap = el("p", "dou-zoom-caption");
    cap.appendChild(el("strong", null, w.title));
    if (w.artistName) cap.appendChild(document.createTextNode("  " + w.artistName));

    var bar = el("div", "dou-zoom-bar");
    var out = zbtn("Zoom out", ICON.minus, function () {
      setScale(scale / 1.4);
    });
    var reset = el("button", null, "Reset");
    reset.type = "button";
    reset.addEventListener("click", function () {
      scale = 1;
      tx = 0;
      ty = 0;
      paint();
    });
    var inb = zbtn("Zoom in", ICON.plus, function () {
      setScale(scale * 1.4);
    });
    bar.appendChild(out);
    bar.appendChild(reset);
    bar.appendChild(inb);

    o.node.appendChild(cap);
    o.node.appendChild(o.closeBtn());
    o.node.appendChild(vp);
    o.node.appendChild(bar);

    var scale = 1;
    var tx = 0;
    var ty = 0;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function paint() {
      img.style.transform =
        "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) scale(" + scale.toFixed(3) + ")";
      img.style.transition = reduce ? "none" : "transform 160ms ease-out";
      vp.setAttribute("data-zoomed", scale > 1.01 ? "true" : "false");
    }
    function setScale(s) {
      scale = Math.min(6, Math.max(1, s));
      if (scale === 1) {
        tx = 0;
        ty = 0;
      }
      paint();
    }
    function zbtn(label, path, fn) {
      var b = el("button");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.appendChild(icon(path));
      b.addEventListener("click", fn);
      return b;
    }

    vp.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        setScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
      },
      { passive: false }
    );

    var pts = {};
    var last = null;
    var pinchStart = 0;
    var pinchScale = 1;
    var moved = false;

    vp.addEventListener("pointerdown", function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      moved = false;
      var ids = Object.keys(pts);
      if (ids.length === 1) last = { x: e.clientX, y: e.clientY };
      else if (ids.length === 2) {
        pinchStart = dist();
        pinchScale = scale;
      }
      if (vp.setPointerCapture) {
        try {
          vp.setPointerCapture(e.pointerId);
        } catch (err) {}
      }
    });

    vp.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      if (ids.length >= 2) {
        var d = dist();
        if (pinchStart > 0) setScale(pinchScale * (d / pinchStart));
        moved = true;
        return;
      }
      if (scale <= 1.01 || !last) return;
      tx += e.clientX - last.x;
      ty += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      moved = true;
      paint();
    });

    function up(e) {
      delete pts[e.pointerId];
      last = null;
      pinchStart = 0;
    }
    vp.addEventListener("pointerup", up);
    vp.addEventListener("pointercancel", up);

    function dist() {
      var ids = Object.keys(pts);
      if (ids.length < 2) return 0;
      var a = pts[ids[0]];
      var b = pts[ids[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    img.addEventListener("dblclick", function () {
      setScale(scale > 1.01 ? 1 : 2.2);
    });

    img.addEventListener("error", function () {
      img.remove();
      var fb = el("div", "dou-panelbox");
      fb.appendChild(el("h2", null, w.title));
      fb.appendChild(el("p", null, "This image could not be displayed."));
      vp.appendChild(fb);
    });

    o.node.addEventListener("pointerdown", function (e) {
      if (e.target === o.node) o.pendingBackdrop = true;
    });
    o.node.addEventListener("click", function (e) {
      if (e.target === o.node && o.pendingBackdrop && !moved) o.close();
      o.pendingBackdrop = false;
    });

    paint();
    o.open();
  };

  /* ---------- biography modal ------------------------------------- */

  Gallery.prototype.openBio = function (work, trigger) {
    var artist = work.artist;
    if (!hasBio(artist)) return;
    var name = artist.name || work.artistName;
    var o = new Overlay(trigger, "About " + name);

    var box = el("div", "dou-bio");
    var head = el("div", "dou-bio-head");
    var photo = authorPhoto(artist, 600);
    if (photo) {
      var img = el("img", "dou-bio-photo");
      img.src = photo;
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("error", function () {
        img.replaceWith(el("span", "dou-bio-initials", initials(name)));
      });
      head.appendChild(img);
    } else {
      head.appendChild(el("span", "dou-bio-initials", initials(name)));
    }
    var titles = el("div");
    var h = el("h2", null, name);
    titles.appendChild(h);
    head.appendChild(titles);

    var body = el("div", "dou-bio-body");
    body.tabIndex = 0;
    var bio = authorBio(artist);
    if (bio) {
      bio
        .split(/\r?\n+/)
        .filter(function (p) {
          return p.trim();
        })
        .forEach(function (para) {
          var p = el("p");
          para
            .split(/\n/)
            .forEach(function (line, i) {
              if (i) p.appendChild(document.createElement("br"));
              p.appendChild(document.createTextNode(line));
            });
          body.appendChild(p);
        });
    } else {
      body.appendChild(el("p", null, "No biography available yet."));
    }

    box.appendChild(head);
    box.appendChild(body);
    box.appendChild(o.closeBtn());
    o.node.appendChild(box);

    o.node.addEventListener("mousedown", function (e) {
      o.pendingBackdrop = e.target === o.node;
    });
    o.node.addEventListener("click", function (e) {
      if (e.target === o.node && o.pendingBackdrop) o.close();
      o.pendingBackdrop = false;
    });

    o.open();
  };

  /* ---------- flyer / standalone image triggers -------------------- */

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-dou-image]") : null;
    if (!t) return;
    var url = t.getAttribute("data-dou-image");
    if (!url) return;
    e.preventDefault();
    openImageOverlay({
      url: url,
      alt: t.getAttribute("data-dou-image-alt") || "",
      title: t.getAttribute("data-dou-image-title") || "",
      trigger: t
    });
  });

  /* ---------- boot ------------------------------------------------ */

  function init() {
    var root = document.querySelector("[data-dou-root]");
    if (!root || root.getAttribute("data-dou-ready") === "true") return false;
    root.setAttribute("data-dou-ready", "true");
    try {
      new Gallery(root);
    } catch (e) {
      if (window.console && console.error) console.error("[dou-gallery]", e);
    }
    return true;
  }

  if (!init()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    }
    var obs = new MutationObserver(function () {
      if (init()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () {
      obs.disconnect();
    }, 15000);
  }
})();
