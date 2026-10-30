/** A valid selection that cannot be charted from the available observations. */
export class ComparisonCoverageError extends Error {}

export function comparisonErrorResponse(error: unknown) {
  if (error instanceof ComparisonCoverageError) {
    return Response.json({error: error.message}, {status: 422});
  }
  // Infrastructure failures remain server errors without exposing project details.
  return Response.json({error: 'Unable to load stored price history. Please try again.'}, {status: 503});
}
