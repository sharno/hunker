// Elm cannot size sticky scroll regions from their visible top without
// routing every scroll event through its update loop, so this measures them
// in the browser and exposes the result as a CSS variable.
let viewportScrollRegionFrame;
const sizeViewportScrollRegions = () => {
  viewportScrollRegionFrame = undefined;
  document
    .querySelectorAll("[data-viewport-scroll-region]")
    .forEach((region) => {
      const visibleTop = Math.max(0, region.getBoundingClientRect().top);
      region.style.setProperty(
        "--viewport-scroll-region-top",
        `${visibleTop}px`,
      );
    });
};
const scheduleViewportScrollRegionSize = () => {
  if (viewportScrollRegionFrame === undefined) {
    viewportScrollRegionFrame = requestAnimationFrame(
      sizeViewportScrollRegions,
    );
  }
};

addEventListener("scroll", scheduleViewportScrollRegionSize, { passive: true });
addEventListener("resize", scheduleViewportScrollRegionSize, { passive: true });
new MutationObserver(scheduleViewportScrollRegionSize).observe(document.body, {
  childList: true,
  subtree: true,
});
scheduleViewportScrollRegionSize();
