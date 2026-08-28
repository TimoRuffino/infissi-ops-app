
export function isPathActive(location: string, path: string): boolean {
  return path === "/"
    ? location === "/"
    : location === path || location.startsWith(`${path}/`);
}

export function navigationItemState(
  location: string,
  path: string,
  childPaths: string[]
): { active: boolean; containsActiveChild: boolean } {
  const containsActiveChild = childPaths.some(childPath =>
    isPathActive(location, childPath)
  );
  return {
    active: childPaths.length === 0 && isPathActive(location, path),
    containsActiveChild,
  };
}
