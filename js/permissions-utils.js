// js/permissions-utils.js

export function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return new Date(value);
}

export function isApproved(userData) {
  return userData?.isApproved === true;
}

export function isAdmin(userData) {
  return userData?.role === 'admin';
}

export function isExperimentPublic(exp, trustedNow) {
  if (!exp) return false;

  if (!('visibility' in exp)) return true;

  if (exp.visibility === 'public') return true;

  if (exp.visibility === 'private') {
    const until = timestampToDate(exp.privateUntil);
    return until && until <= trustedNow;
  }

  return false;
}

export function getRole(exp, user, userData, ownerUid) {
  if (!user) return 'none';

  if (isAdmin(userData)) return 'admin';

  if (ownerUid === user.uid) return 'owner';

  if (exp.permissions?.[user.uid]?.role === 'editor') return 'editor';
  if (exp.permissions?.[user.uid]?.role === 'viewer') return 'viewer';

  return 'public';
}

export function canRead(exp, user, userData, trustedNow, ownerUid) {
  if (!user || !isApproved(userData)) return false;

  const role = getRole(exp, user, userData, ownerUid);

  return (
    role === 'admin' ||
    role === 'owner' ||
    role === 'editor' ||
    role === 'viewer' ||
    isExperimentPublic(exp, trustedNow)
  );
}

export function canEdit(exp, user, userData, trustedNow, ownerUid) {
  const role = getRole(exp, user, userData, ownerUid);

  return role === 'admin' || role === 'owner' || role === 'editor';
}

export function canManage(exp, user, userData, ownerUid) {
  const role = getRole(exp, user, userData, ownerUid);
  return role === 'admin' || role === 'owner';
}
