// NEXUS RETAIL — sensor adapter.
// Default: rule-driven SIMULATED obstacles. No trained classifier is connected.
// External providers can be registered with window.INT6143_SENSOR.registerProvider(fn).
import { peopleForScenario } from './storeData.js';

let provider = null;
export function registerSensorProvider(nextProvider) {
  if (nextProvider !== null && typeof nextProvider !== 'function') throw new TypeError('Sensor provider must be a synchronous function or null');
  provider = nextProvider;
}
export function getObstacleSnapshot(scenario, slot) {
  const simulated = peopleForScenario(scenario, slot).map(person => ({ ...person, type: 'person' }));
  simulated.push({ id: 'cart', type: 'cart', zone: 'Cart park / aisle', point: scenario === 'peak' ? [69, 34] : [116, 81] });
  if (!provider) return simulated;
  try {
    const values = provider({ scenario, slot });
    if (!Array.isArray(values)) return simulated;
    return values.filter(item => item && ['person', 'cart'].includes(item.type)
      && Array.isArray(item.point) && item.point.length === 2
      && item.point.every(value => Number.isFinite(value)))
      .map((item, i) => ({
        id: String(item.id ?? `external-${i}`), type: item.type,
        zone: String(item.zone ?? 'Unlabelled zone'), point: [...item.point],
      }));
  } catch (error) {
    console.warn('External sensor unavailable; falling back to simulated obstacles.', error);
    return simulated;
  }
}
