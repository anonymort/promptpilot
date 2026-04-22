export function createApiError(message, status = 0) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function shouldClearStoredToken(error) {
  return error?.status === 401 || error?.status === 403;
}
