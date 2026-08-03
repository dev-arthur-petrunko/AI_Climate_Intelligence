/**
 * Solar utilities — субсолярна точка (де Сонце зараз у зеніті) та денна/нічна
 * межа (термінатор) для 3D-глобуса. Дає змогу освітлювати планету реальним
 * напрямком Сонця та обертати її відповідно до фактичного часу.
 */

/** Підсонячна точка (субсолярна): широта/довгота, де Сонце зараз прямо над головою. */
export interface SubsolarPoint {
  lat: number;
  lon: number;
}

/** Кут нахилу осі Землі (град). */
export const EARTH_AXIAL_TILT_DEG = 23.44;

/** Конвертація часу в частку року (дні з 1 січня). */
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return (d.getTime() - start) / 86400000;
}

/**
 * Обчислення субсолярної точки за поточною датою/часом (UTC).
 * Алгоритм NOAA Solar Calculator (спрощений, точність ~0.01°).
 */
export function getSubsolarPoint(date: Date = new Date()): SubsolarPoint {
  const n = dayOfYear(date);
  const hoursUTC = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // Середня довгота Сонця та середня аномалія (в град)
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);

  // Еклиптична довгота Сонця
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);

  // Нахил екліптики (град)
  const epsilon = 23.439 - 0.0000004 * n;

  // Схилення Сонця (градуси) = широта субсолярної точки
  const sinDec = Math.sin(epsilon * (Math.PI / 180)) * Math.sin(lambda);
  const lat = Math.asin(Math.min(1, Math.max(-1, sinDec))) * (180 / Math.PI);

  // Рівняння часу (хвилини)
  const y = Math.tan((epsilon / 2) * (Math.PI / 180));
  const eot =
    4 *
    (y * Math.sin(2 * lambda) -
      2 * 0.01671 * Math.sin(g) +
      4 * 0.01671 * y * Math.sin(g) * Math.cos(2 * lambda) -
      0.5 * y * y * Math.sin(4 * lambda) -
      1.25 * 0.01671 * 0.01671 * Math.sin(2 * g));

  // Годинний кут (градуси) — зсув від сонячної півночі
  const hourAngle = 15 * (hoursUTC - 12 + eot / 60);

  // Довгота субсолярної точки (від'ємна — Сонце на сході від Грінвіча)
  let lon = -hourAngle;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;

  return { lat, lon };
}

/** Чи є точка (lat, lon) освітленою Сонцем у вказаний момент. */
export function isDaylight(
  lat: number,
  lon: number,
  date: Date = new Date()
): boolean {
  const sub = getSubsolarPoint(date);
  // Кутова відстань від субсолярної точки < 90° — вдень
  const dLat = ((lat - sub.lat) * Math.PI) / 180;
  const dLon = ((lon - sub.lon) * Math.PI) / 180;
  const cosC =
    Math.sin((lat * Math.PI) / 180) * Math.sin((sub.lat * Math.PI) / 180) +
    Math.cos((lat * Math.PI) / 180) *
      Math.cos((sub.lat * Math.PI) / 180) *
      Math.cos(dLon);
  const centralAngle = Math.acos(Math.min(1, Math.max(-1, cosC)));
  return centralAngle < Math.PI / 2;
}

/** Напрямок на Сонце у 3D-сцені (поза глобусом). Повертає нормалізований вектор. */
export function sunDirection(date: Date = new Date(), radius = 1): [number, number, number] {
  const { lat, lon } = getSubsolarPoint(date);
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}
