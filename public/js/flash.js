// "Just changed" highlight, shared by the home page and the scoreboard.
//
// flash(element, kind) briefly highlights an element for about 600ms:
//   kind "usa"  -> a number pulses and glows red
//   kind "eu"   -> a number pulses and glows blue
//   kind "card" -> a card gets a navy ring that fades out
// The look itself lives in style.css (section 7, .flash-*), including
// a calmer version for people who turned on "Reduce motion".
//
// The pages call this only when a score changed AFTER the first load,
// so opening the page never makes everything flash at once.

const DURATION_MS = 600;

export function flash(element, kind) {
  if (!element) return;
  const className = `flash-${kind}`;
  // If the same element is already flashing, restart the animation:
  // remove the class, force the browser to apply that change right now
  // (reading offsetWidth makes it recalculate layout, a standard trick),
  // then add the class back.
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  // Remove the class afterwards. If the element was replaced in the
  // meantime (pages redraw on every update), this simply does nothing.
  setTimeout(() => element.classList.remove(className), DURATION_MS);
}
