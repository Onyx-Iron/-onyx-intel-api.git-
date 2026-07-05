export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(
  searchParams: URLSearchParams,
  defaultLimit = 50,
): PaginationParams {
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit),
  );
  return { page, limit, offset: (page - 1) * limit };
}

export function paginationMeta(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    hasMore: page * limit < total,
  };
}
