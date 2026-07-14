(function() {
  var footer = document.createElement('footer');
  footer.style.cssText = 'text-align:center;padding:1.5rem;font-size:0.72rem;color:#6e7a8a;border-top:1px solid #252d3d;margin-top:2rem;';
  footer.innerHTML = 'EODdb.com &mdash; built by EODGamer&nbsp; · &nbsp;' +
    '<a href="/about" style="color:#6e7a8a;text-decoration:none;">About</a>&nbsp; · &nbsp;' +
    '<a href="/privacy" style="color:#6e7a8a;text-decoration:none;">Privacy Policy</a>';
  var links = footer.querySelectorAll('a');
  for (var i = 0; i < links.length; i++) {
    links[i].onmouseenter = function() { this.style.color = '#c9d1d9'; };
    links[i].onmouseleave = function() { this.style.color = '#6e7a8a'; };
  }
  document.body.appendChild(footer);
})();
