/**
 * Moon utilities — геоцентричне положення Місяця (Meeus, спрощений ряд) та
 * сублунарна точка (де Місяць зараз у зеніті). Використовує той самий
 * lat/lon → 3D конвенцію, що й solar.ts, тому сублунарна довгота збігається
 * з географічною довготою на текстурі глобуса.
 */

/** Конвертація UTC-часу у юліанську дату. */
function dateToJD(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

function norm180(x: number): number {
  return (((x + 180) % 360) + 360) % 360 - 180;
}

const DEG = Math.PI / 180;

/** Greenwich Mean Sidereal Time у градусах. */
export function getGMST(date: Date = new Date()): number {
  const d = dateToJD(date) - 2451545.0;
  const T = d / 36525;
  let gmst = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000;
  return norm360(gmst);
}

/** Сублунарна точка: широта = схилення Місяця, довгота = RA − GMST. */
export function getSubLunarPoint(date: Date = new Date()): { lat: number; lon: number } {
  const d = dateToJD(date) - 2451545.0;
  // Ряди Meeus задані на юліанський вік (T) від епохи J2000, а не на добу.
  const T = d / 36525;

  // Середні орбітальні елементи Місяця (град)
  const Lp = norm360(218.3164477 + 481267.88123421 * T);
  const D = norm360(297.8501921 + 445267.1114034 * T);
  const M = norm360(357.5291092 + 35999.0502909 * T);
  const Mp = norm360(134.9633964 + 477198.8675055 * T);
  const F = norm360(93.272095 + 483202.0175233 * T);

  const s = (x: number) => Math.sin(x * DEG);

  // Екліптична довгота Місяця
  const lambda =
    Lp +
    6.288774 * s(Mp) +
    1.274027 * s(2 * D - Mp) +
    0.658314 * s(2 * D) +
    0.213618 * s(2 * Mp) -
    0.185116 * s(M) -
    0.114332 * s(2 * F) -
    0.058793 * s(2 * D - 2 * Mp) -
    0.057066 * s(2 * D - M + Mp) +
    0.053322 * s(2 * D + Mp) +
    0.045758 * s(2 * D - M) -
    0.040923 * s(M - Mp) -
    0.03472 * s(D) -
    0.030383 * s(M + Mp) +
    0.015327 * s(2 * D - 2 * M) -
    0.012528 * s(Mp + 2 * F) -
    0.01098 * s(Mp - 2 * F) +
    0.010674 * s(4 * D - Mp) +
    0.010034 * s(3 * Mp) +
    0.008548 * s(4 * D - 2 * Mp);

  // Екліптична широта Місяця
  const beta =
    5.128189 * s(F) +
    0.280606 * s(Mp + F) +
    0.277693 * s(Mp - F) +
    0.173238 * s(2 * D - F) -
    0.055413 * s(2 * D - Mp - F) -
    0.093951 * s(2 * D + Mp - F) +
     0.032693 * s(2 * D + Mp + F) +
     0.011098 * s(2 * D + Mp - F - M);

  // Нахил екліптики (Meeus, на юліанський вік)
  const eps = (23.439291111 - 0.013004167 * T) * DEG;

  // Екліптичні → екваторіальні (RA, Dec)
  const lam = lambda * DEG;
  const bet = beta * DEG;
  const sinDec = Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam);
  const dec = Math.asin(Math.min(1, Math.max(-1, sinDec))) / DEG;
  const ra = norm360(Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam)) / DEG);

  return { lat: dec, lon: norm180(ra - getGMST(date)) };
}

/** Напрямок на Місяць у 3D-сцені (той самий конвенцій latLonToVec3, що й Сонце). */
export function moonDirection(date: Date = new Date(), radius = 1): [number, number, number] {
  const { lat, lon } = getSubLunarPoint(date);
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

/**
 * Фаза Місяця — розраховується локально (формула, API не потрібен).
 * Повертає частку освітленої поверхні (0..1), вік Місяця в днях та
 * індекс фази 0..7 (новолуння → повний місяць → новолуння).
 */
export function moonPhase(date: Date = new Date()): {
  illumination: number;
  ageDays: number;
  phaseIndex: number;
} {
  // Синодичний місяць: 29.530588853 діб. Нульова точка — новолуння 2000-01-06 18:14 UTC.
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
  const days = (date.getTime() - knownNewMoon) / 86400000;
  const ageDays = ((days % 29.530588853) + 29.530588853) % 29.530588853;

  // Освітленість за кутом між Сонцем і Місяцем (емпірична синусоїда).
  const illumination = (1 - Math.cos((ageDays / 29.530588853) * 2 * Math.PI)) / 2;

  const phaseIndex = Math.round((ageDays / 29.530588853) * 8) % 8;
  return { illumination, ageDays, phaseIndex };
}
