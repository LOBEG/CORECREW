(function(){
  var toggle=document.getElementById('navToggle'),
      nav=document.getElementById('mainNav'),
      overlay=document.getElementById('navOverlay');
  if(toggle&&nav){
    toggle.addEventListener('click',function(){
      nav.classList.toggle('nav-open');
      if(overlay) overlay.classList.toggle('active');
      toggle.setAttribute('aria-expanded',nav.classList.contains('nav-open'));
    });
    if(overlay){
      overlay.addEventListener('click',function(){
        nav.classList.remove('nav-open');
        overlay.classList.remove('active');
        toggle.setAttribute('aria-expanded','false');
      });
    }
  }
})();
