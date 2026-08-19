export type UtilizzoTars = {
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite5m: number;
  tokensCacheWrite1h: number;
};

export function metricheUtilizzoTars(usage: UtilizzoTars) {
  const cacheWrite = usage.tokensCacheWrite5m + usage.tokensCacheWrite1h;
  const inputTotale = usage.tokensIn + usage.tokensCacheRead + cacheWrite;
  return {
    inputTotale,
    tokenTotali: inputTotale + usage.tokensOut,
    cacheReadPercent:
      inputTotale > 0
        ? Math.round((usage.tokensCacheRead / inputTotale) * 100)
        : 0,
    cacheWrite,
  };
}
