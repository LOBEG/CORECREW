// Stat counter with IntersectionObserver, easing, and "+" suffix appended at target value
document.addEventListener("DOMContentLoaded", function() {
  var counters = document.querySelectorAll('.stat-number[data-target]');

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateCounter(counter) {
    var target = +counter.getAttribute('data-target');
    var duration = 1400;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var elapsed = timestamp - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var easedProgress = easeOutCubic(progress);
      var current = Math.round(easedProgress * target);

      counter.textContent = current.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        counter.textContent = target.toLocaleString() + '+';
      }
    }

    requestAnimationFrame(step);
  }

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });

    counters.forEach(function(counter) {
      counter.textContent = '0';
      observer.observe(counter);
    });
  } else {
    // Fallback for browsers without IntersectionObserver
    counters.forEach(function(counter) {
      animateCounter(counter);
    });
  }
});