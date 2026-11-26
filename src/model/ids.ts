let counter = 0;
/** A unique id for a strip, step or custom wood, used as a stable list key. */
export const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
