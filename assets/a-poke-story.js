(() => {
  const story = document.querySelector('[data-poke-story]');
  if (!story || window.matchMedia('(max-width: 850px), (prefers-reduced-motion: reduce)').matches) return;

  const clamp = value => Math.min(1, Math.max(0, value));
  const between = (value, start, end) => clamp((value - start) / (end - start));
  const smooth = value => value * value * (3 - 2 * value);
  const progressFor = element => {
    const travel = Math.max(element.offsetHeight - window.innerHeight, 1);
    return clamp(-element.getBoundingClientRect().top / travel);
  };

  const heroTitle = story.querySelector('.poke-story__title');
  const heroLead = story.querySelector('.poke-story__lead');
  const problem = story.querySelector('[data-poke-problem]');
  const problemMedia = story.querySelector('[data-poke-problem-media]');
  const problemCopy = story.querySelector('[data-poke-problem-copy]');
  const question = story.querySelector('[data-poke-question]');
  const questionCopy = story.querySelector('[data-poke-question-copy]');
  const principles = document.querySelector('[data-poke-principles]');
  const principlesHeading = principles?.querySelector('[data-poke-principles-heading]');
  const principleItems = [...(principles?.querySelectorAll('[data-poke-principle]') || [])];
  const closing = document.querySelector('[data-poke-closing]');
  const closingCopy = closing?.querySelector('[data-poke-closing-copy]');
  const closingAction = closing?.querySelector('[data-poke-closing-action]');

  const renderStory = () => {
    const progress = progressFor(story);
    const heroOut = smooth(between(progress, .12, .38));
    const problemIn = smooth(between(progress, .25, .54));
    const blackIn = smooth(between(progress, .6, .82));
    heroTitle.style.transform = `translate3d(${-132 * heroOut}vw, ${-8 * heroOut}vh, 0)`;
    heroTitle.style.opacity = String(1 - heroOut);
    heroLead.style.transform = `translate3d(0, ${-108 * heroOut}vh, 0)`;
    heroLead.style.opacity = String(1 - heroOut);
    problem.style.opacity = String(problemIn * (1 - blackIn * .55));
    problemMedia.style.transform = `translate3d(${-54 * (1 - problemIn)}vw, ${62 * (1 - problemIn)}vh, 0)`;
    problemCopy.style.transform = `translate3d(${48 * (1 - problemIn)}vw, ${72 * (1 - problemIn)}vh, 0)`;
    question.style.clipPath = `inset(${100 - blackIn * 100}% 0 0 0)`;
    questionCopy.style.opacity = String(blackIn);
    questionCopy.style.transform = `translate3d(0, ${88 * (1 - blackIn)}px, 0)`;
  };

  const renderPrinciples = () => {
    if (!principles || !principlesHeading) return;
    const progress = progressFor(principles);
    const headingProgress = smooth(between(progress, 0, .42));
    principlesHeading.style.opacity = String(1 - headingProgress * .25);
    principlesHeading.style.transform = `translate3d(0, ${-62 * headingProgress}px, 0)`;
    principleItems.forEach((item, index) => {
      const itemProgress = smooth(between(progress, .12 + index * .13, .43 + index * .13));
      item.style.opacity = String(itemProgress);
      item.style.transform = `translate3d(0, ${62 * (1 - itemProgress)}px, 0)`;
    });
  };

  const renderClosing = () => {
    if (!closing || !closingCopy || !closingAction) return;
    const progress = progressFor(closing);
    const copyProgress = smooth(between(progress, .12, .7));
    const actionProgress = smooth(between(progress, .42, .86));
    closingCopy.style.opacity = String(copyProgress);
    closingCopy.style.transform = `translate3d(0, ${86 * (1 - copyProgress)}px, 0)`;
    closingAction.style.opacity = String(actionProgress);
    closingAction.style.transform = `translate3d(0, ${32 * (1 - actionProgress)}px, 0)`;
  };

  let frame = 0;
  const render = () => {
    frame = 0;
    renderStory();
    renderPrinciples();
    renderClosing();
  };
  const requestRender = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };
  addEventListener('scroll', requestRender, { passive: true });
  addEventListener('resize', requestRender);
  requestRender();
})();
