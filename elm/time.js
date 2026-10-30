// <hunker-time datetime="unix milliseconds"> shows an instant in the viewer's
// time zone: relative while recent, a date after a week, and the exact time
// on hover. It renders into its own shadow root so Elm's virtual DOM never
// sees its text, and one timer keeps every relative label current.
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const exact = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const day = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const dayWithYear = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

// Units from largest to smallest, in milliseconds.
const units = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];
const week = 7 * 86_400_000;

const label = (instant, now) => {
  const elapsed = now - instant.getTime();
  if (elapsed >= week || elapsed < -week) {
    return instant.getFullYear() === new Date(now).getFullYear()
      ? day.format(instant)
      : dayWithYear.format(instant);
  }
  const [unit, size] = units.find(
    ([, length]) => Math.abs(elapsed) >= length,
  ) ?? ["minute", 60_000];
  return relative.format(-Math.round(elapsed / size), unit);
};

const live = new Set();

class HunkerTime extends HTMLElement {
  static observedAttributes = ["datetime"];

  connectedCallback() {
    live.add(this);
    this.render();
  }

  disconnectedCallback() {
    live.delete(this);
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const instant = new Date(Number(this.getAttribute("datetime")));
    if (Number.isNaN(instant.getTime())) return;
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.textContent = label(instant, Date.now());
    this.title = exact.format(instant);
  }
}

customElements.define("hunker-time", HunkerTime);
setInterval(() => live.forEach((element) => element.render()), 60_000);
