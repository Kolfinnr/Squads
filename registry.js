// Tiny service locator to decouple modules without global imports
const services = new Map();
export function registerService(key, svc) { services.set(key, svc); }
export function getService(key) { return services.get(key); }
