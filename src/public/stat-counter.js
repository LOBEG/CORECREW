// Improved stat counter: always animates on every device (mobile & desktop)
document.addEventListener("DOMContentLoaded", function() {
  const counters = document.querySelectorAll('.stat-number[data-target]');
  counters.forEach(counter => {
    const target = +counter.getAttribute('data-target');
    let current = 0;
    const steps = 40; // Faster for mobile, 40 steps
    const increment = Math.max(1, Math.ceil(target / steps));
    const duration = 1000; // ms
    const interval = duration / Math.ceil(target / increment);

    function updateCounter() {
      current += increment;
      if (current > target) current = target;
      counter.textContent = current.toLocaleString();

      if (current < target) {
        setTimeout(updateCounter, interval);
      } else {
        counter.textContent = target.toLocaleString();
      }
    }
    updateCounter();
  });
});