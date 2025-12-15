export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function getPaginationParams(query: any): PaginationOptions {
  const page = Math.max(1, parseInt(query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 20));
  return { page, limit };
}

export function paginate<T>(data: T[], options: PaginationOptions): PaginatedResult<T> {
  const { page, limit } = options;
  const start = (page - 1) * limit;
  const end = start + limit;
  const paginatedData = data.slice(start, end);
  const totalPages = Math.ceil(data.length / limit);

  return {
    data: paginatedData,
    pagination: {
      page,
      limit,
      total: data.length,
      totalPages,
    },
  };
}

