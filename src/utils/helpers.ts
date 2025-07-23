export function isNotFoundError(error: any): boolean {
  return (
    error.stack.includes("404") ||
    error.message.includes("Not Found") ||
    error.message.includes("404") ||
    error.code === 404
  );
}
