(function () {
  'use strict';
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function on(arr, type, fn) {
    for (var i = 0; i < arr.length; i++) arr[i].addEventListener(type, fn);
  }

  var headline = document.querySelector('.hero h1');
  if (headline && !prefersReduced) {
    var letters = headline.textContent.split('');
    headline.textContent = '';
    var span = document.createElement('span');
    span.style.display = 'inline-block';
    span.innerHTML = letters.map(function (l) {
      return l === '\n' ? '<br>' : '<span class="hl">' + (l === ' ' ? '\u00A0' : l) + '</span>';
    }).join('');
    var hls = span.querySelectorAll('.hl');
    hls.forEach(function (el, i) {
      el.style.display = 'inline-block';
      el.style.animation = 'letterIn 0.6s cubic-bezier(.2,.7,.2,1) both';
      el.style.animationDelay = (0.15 + i * 0.022) + 's';
    });
    headline.appendChild(span);
  }

  var track = document.getElementById('tickerTrack');
  if (track && !prefersReduced) {
    track.innerHTML += track.innerHTML;
    var gap = getComputedStyle(track).columnGap || '22px';
    track.style.setProperty('--tick-gap', gap);
  }

  var spotlight = document.getElementById('spotlight');
  if (spotlight && !prefersReduced) {
    spotlight.addEventListener('mousemove', function (e) {
      var r = spotlight.getBoundingClientRect();
      var x = ((e.clientX - r.left) / r.width) * 100;
      var y = ((e.clientY - r.top) / r.height) * 100;
      spotlight.style.setProperty('--mx', x + '%');
      spotlight.style.setProperty('--my', y + '%');
    });
  }

  function tilt(el) {
    var strength = 7;
    el.addEventListener('mousemove', function (e) {
      if (prefersReduced) return;
      var r = el.getBoundingClientRect();
      var px = (e.clientX - r.left - r.width / 2) / (r.width / 2);
      var py = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      el.style.transform = 'perspective(700px) rotateY(' + (px * strength).toFixed(2) + 'deg) rotateX(' + (-py * strength).toFixed(2) + 'deg) translateY(-4px)';
      el.style.boxShadow = '0 22px 50px -18px rgba(56,189,248,0.28)';
      el.style.borderColor = 'rgba(96,120,187,0.55)';
    });
    el.addEventListener('mouseleave', function () {
      el.style.transform = '';
      el.style.boxShadow = '';
      el.style.borderColor = '';
    });
  }
  on(Array.prototype.slice.call(document.querySelectorAll('.tilt-card')), 'mouseenter', function () { tilt(this); });

  var nav = document.getElementById('topNav');
  function navShadow() {
    if (!nav) return;
    if (window.scrollY > 10) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  }
  window.addEventListener('scroll', navShadow, { passive: true });
  navShadow();

  var revealEls = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  if ('IntersectionObserver' in window && revealEls.length && !prefersReduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  var countEls = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
  if (countEls.length && !prefersReduced && 'IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        cio.unobserve(el);
        var target = parseFloat(el.getAttribute('data-count'));
        var dur = 900;
        var start = null;
        function frame(ts) {
          if (!start) start = ts;
          var p = Math.min((ts - start) / dur, 1);
          el.textContent = (target * (1 - Math.pow(1 - p, 3))).toFixed(el.getAttribute('data-dec') === '1' ? 1 : 0);
          if (p < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
    }, { threshold: 0.4 });
    countEls.forEach(function (el) { cio.observe(el); });
  }
})();