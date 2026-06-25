'use strict';

/**
 * Normalize Step 3 wizard fields (supports legacy host/name/user/password keys).
 * @param {object|undefined} step3
 */
function normalizeStep3(step3) {
  if (!step3 || typeof step3 !== 'object') return {};
  const dbType = step3.dbType || 'postgres';
  const defaultPort = dbType === 'mysql' ? 3306 : 5432;
  const dbPort = step3.dbPort ?? step3.port ?? defaultPort;
  const dbLocation = step3.dbLocation || 'managed';
  return {
    ...step3,
    dbHost: step3.dbHost || step3.host || (dbLocation === 'managed' ? 'db' : 'localhost'),
    dbPort,
    dbName: step3.dbName || step3.name || '',
    dbUser: step3.dbUser || step3.user || '',
    dbPassword: step3.dbPassword ?? step3.password ?? '',
  };
}

/** @param {object|undefined} step3 */
function isManagedDb(step3) {
  const s = normalizeStep3(step3);
  return !s.skipDb && s.dbLocation === 'managed' && s.dbType !== 'sqlite';
}

module.exports = { normalizeStep3, isManagedDb };
