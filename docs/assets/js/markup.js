// Page markup for embeds (Tilda T123 etc.): main.js injects this when #stage is missing.
export const MARKUP = `<div class="mh-bg" aria-hidden="true"></div>
<main id="stage" class="stage strip" aria-label="selected works"><div class="track"></div></main>

<section id="project" class="layer project" aria-label="shoot" hidden>
  <a class="p-title" id="p-title" href="#"></a>
  <div class="stage strip" id="project-stage"><div class="track"></div></div>
</section>

<section id="wardrobe" class="layer wardrobe" aria-label="wardrobe" hidden>
  <div class="scroll">
    <div id="sections"></div>
  </div>
</section>

<section id="contact" class="contact" aria-label="contact" hidden>
  <div class="info" id="contact-body"></div>
</section>

<nav class="nav" aria-label="site">
  <a href="#/contact" id="nav-contact">contact</a>
  <a href="#/wardrobe" id="nav-gallery">wardrobe</a>
</nav>

<div id="viewer" class="viewer" role="dialog" aria-modal="true" aria-label="look" hidden>
  <div class="v-top"><span class="v-count" id="v-count"></span><button type="button" class="v-close" id="v-close">close</button></div>
  <div class="v-stage" id="v-stage"></div>
  <div class="v-arrows"><button type="button" class="prev" id="v-prev" aria-label="previous"></button><button type="button" class="next" id="v-next" aria-label="next"></button></div>
  <div class="v-bottom" id="v-bottom"></div>
</div>`;
